import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IntentApiClient, type IntentMcpConfig } from "@pokt-mcp/shared";
import type {
  PrepareIntentResponse,
  SigningInstructions,
  SubmitIntentResponse,
} from "./intent-swap-types.js";

export interface TokenHit {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

export interface SanitizedQuote {
  quoteId: string;
  expiresAt: string;
  route: string;
  routeType: string;
  fromChain: number;
  toChain: number;
  tokenIn: { address: string; symbol: string; amount: string };
  tokenOut: { address: string; symbol: string; amountEstimated: string };
  priceImpactBps?: number;
  platformFeeBps: number;
  gasEstimateUsd?: number;
  executionMode?: string;
  warnings: string[];
  nextStep?: string;
}

export interface IntentMcpSwapClient {
  searchToken(chainId: number, query: string): Promise<TokenHit | null>;
  getSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote>;
  prepareIntent(quoteId: string, walletAddress: string): Promise<PrepareIntentResponse>;
  getSigningInstructions(intentId: string): Promise<SigningInstructions>;
  submitSignedIntent(intentId: string, signature: string): Promise<SubmitIntentResponse>;
  getIntentStatus(intentId: string): Promise<Record<string, unknown>>;
  /** Release remote MCP session (no-op for REST client). */
  close(): Promise<void>;
}

function extractToolText(content: unknown): string {
  if (!Array.isArray(content)) {
    throw new Error("Unexpected MCP tool response shape");
  }
  const textItem = content.find(
    (item) => typeof item === "object" && item !== null && (item as { type?: string }).type === "text",
  ) as { text?: string } | undefined;
  const text = textItem?.text?.trim();
  if (!text) throw new Error("MCP tool returned no text content");
  return text;
}

function parseToolJson<T>(content: unknown): T {
  const text = extractToolText(content);
  try {
    const parsed = JSON.parse(text) as T & { error?: string };
    if (parsed && typeof parsed === "object" && "error" in parsed && parsed.error) {
      throw new Error(String(parsed.error));
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(text);
    }
    throw err;
  }
}

class RestIntentMcpSwapClient implements IntentMcpSwapClient {
  private readonly client: IntentApiClient;

  constructor(config: IntentMcpConfig) {
    this.client = new IntentApiClient(config);
  }

  async searchToken(chainId: number, query: string): Promise<TokenHit | null> {
    const data = await this.client.get<{ tokens: TokenHit[] }>(
      `/v1/tokens/search?chainId=${chainId}&query=${encodeURIComponent(query)}`,
    );
    const tokens = data.tokens ?? [];
    const exact = tokens.find((t) => t.symbol.toLowerCase() === query.toLowerCase());
    return exact ?? tokens[0] ?? null;
  }

  async getSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote> {
    const data = await this.client.post<{ quote: SanitizedQuote }>("/v1/quote", body);
    return data.quote;
  }

  async prepareIntent(quoteId: string, walletAddress: string): Promise<PrepareIntentResponse> {
    return this.client.post<PrepareIntentResponse>("/v1/intents/prepare", {
      quoteId,
      userConfirmed: true,
      walletAddress,
    });
  }

  async getSigningInstructions(intentId: string): Promise<SigningInstructions> {
    const data = await this.client.get<{ instructions: SigningInstructions }>(
      `/v1/intents/${encodeURIComponent(intentId)}/signing`,
    );
    return data.instructions ?? (data as unknown as SigningInstructions);
  }

  async submitSignedIntent(intentId: string, signature: string): Promise<SubmitIntentResponse> {
    const data = await this.client.post<{ result: SubmitIntentResponse }>("/v1/intents/submit", {
      intentId,
      signature,
    });
    return data.result ?? (data as unknown as SubmitIntentResponse);
  }

  async getIntentStatus(intentId: string): Promise<Record<string, unknown>> {
    const data = await this.client.get<{ status: Record<string, unknown> }>(
      `/v1/intents/${encodeURIComponent(intentId)}`,
    );
    return data.status ?? (data as unknown as Record<string, unknown>);
  }

  async close(): Promise<void> {
    /* REST client has no persistent session */
  }
}

class RemoteMcpIntentSwapClient implements IntentMcpSwapClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly config: IntentMcpConfig) {}

  private isSessionError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /session not found|already initialized/i.test(message);
  }

  private async resetConnection(): Promise<void> {
    try {
      if (this.transport?.sessionId) {
        await this.transport.terminateSession().catch(() => undefined);
      }
      if (this.client) {
        await this.client.close().catch(() => undefined);
      }
    } finally {
      this.client = null;
      this.transport = null;
      this.connecting = null;
    }
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;

    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client({ name: "pokt-mcp", version: "0.1.0" });
        // Do not pass sessionId — Metalift assigns mcp-session-id on initialize.
        const transport = new StreamableHTTPClientTransport(new URL(this.config.mcpUrl), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
            },
          },
        });
        await client.connect(transport);
        this.client = client;
        this.transport = transport;
      })();
    }

    try {
      await this.connecting;
    } catch (err) {
      this.connecting = null;
      throw err;
    }
    return this.client!;
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      return await this.callToolOnce<T>(name, args);
    } catch (err) {
      if (this.isSessionError(err)) {
        await this.resetConnection();
        return this.callToolOnce<T>(name, args);
      }
      throw err;
    }
  }

  private async callToolOnce<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.ensureConnected();
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(extractToolText(result.content));
    }
    return parseToolJson<T>(result.content);
  }

  async close(): Promise<void> {
    await this.resetConnection();
  }

  async searchToken(chainId: number, query: string): Promise<TokenHit | null> {
    const data = await this.callTool<{ tokens: TokenHit[] }>("search_token", { chainId, query });
    const tokens = data.tokens ?? [];
    const exact = tokens.find((t) => t.symbol.toLowerCase() === query.toLowerCase());
    return exact ?? tokens[0] ?? null;
  }

  async getSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote> {
    const data = await this.callTool<{ quote: SanitizedQuote }>("get_swap_quote", body);
    return data.quote;
  }

  async prepareIntent(quoteId: string, walletAddress: string): Promise<PrepareIntentResponse> {
    return this.callTool<PrepareIntentResponse>("prepare_intent", {
      quoteId,
      userConfirmed: true,
      walletAddress,
    });
  }

  async getSigningInstructions(intentId: string): Promise<SigningInstructions> {
    return this.callTool<SigningInstructions>("get_signing_instructions", { intentId });
  }

  async submitSignedIntent(intentId: string, signature: string): Promise<SubmitIntentResponse> {
    return this.callTool<SubmitIntentResponse>("submit_signed_intent", { intentId, signature });
  }

  async getIntentStatus(intentId: string): Promise<Record<string, unknown>> {
    return this.callTool<Record<string, unknown>>("get_intent_status", { intentId });
  }
}

export function createIntentMcpSwapClient(config: IntentMcpConfig): IntentMcpSwapClient {
  if (config.transport === "mcp-remote") {
    return new RemoteMcpIntentSwapClient(config);
  }
  return new RestIntentMcpSwapClient(config);
}
