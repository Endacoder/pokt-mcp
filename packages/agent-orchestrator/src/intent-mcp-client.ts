import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IntentApiClient, type IntentMcpConfig } from "@pokt-mcp/shared";
import type {
  PrepareIntentResponse,
  SigningInstructions,
  SubmitIntentResponse,
} from "./intent-swap-types.js";
import {
  isRetryableIntentMcpTransportError,
  withIntentMcpTransportRetry,
} from "./intent-mcp-transport.js";

export interface TokenHit {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

export interface QuoteConfirmation {
  quoteId: string;
  walletAddress: string;
  quoteCommitment: string;
  message: string;
  expiresAt: string;
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
  getGaslessSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote>;
  getQuoteConfirmation(quoteId: string, walletAddress: string): Promise<QuoteConfirmation>;
  prepareIntent(
    quoteId: string,
    walletAddress: string,
    options?: { confirmationSignature?: string; acknowledgeUserPaidGas?: boolean },
  ): Promise<PrepareIntentResponse>;
  getSigningInstructions(intentId: string): Promise<SigningInstructions>;
  submitSignedIntent(
    intentId: string,
    signature: string,
    options?: { txHash?: string; walletAddress?: string },
  ): Promise<SubmitIntentResponse>;
  getIntentStatus(intentId: string): Promise<Record<string, unknown>>;
  syncPermitSigner(
    intentId: string,
    signature: string,
    options?: { walletAddress?: string },
  ): Promise<SubmitIntentResponse>;
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

export function unwrapSubmitResponse(data: Record<string, unknown>): SubmitIntentResponse {
  const result = data.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as SubmitIntentResponse;
  }
  return data as SubmitIntentResponse;
}

export function unwrapStatusResponse(data: Record<string, unknown>): Record<string, unknown> {
  const status = data.status;
  if (status && typeof status === "object" && !Array.isArray(status)) {
    return status as Record<string, unknown>;
  }
  return data;
}

export function unwrapInstructionsResponse(data: Record<string, unknown>): SigningInstructions {
  const instructions = data.instructions;
  if (instructions && typeof instructions === "object" && !Array.isArray(instructions)) {
    return instructions as SigningInstructions;
  }
  return data as SigningInstructions;
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

  async getGaslessSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote> {
    try {
      const data = await this.client.post<{ quote: SanitizedQuote }>("/v1/quote/gasless", body);
      return data.quote;
    } catch {
      const data = await this.client.post<{ quote: SanitizedQuote }>("/v1/quote", {
        ...body,
        executionMode: "gasless",
      });
      return data.quote;
    }
  }

  async getQuoteConfirmation(quoteId: string, walletAddress: string): Promise<QuoteConfirmation> {
    return this.client.post<QuoteConfirmation>("/v1/quotes/confirmation", {
      quoteId,
      walletAddress,
    });
  }

  async prepareIntent(
    quoteId: string,
    walletAddress: string,
    options?: { confirmationSignature?: string; acknowledgeUserPaidGas?: boolean },
  ): Promise<PrepareIntentResponse> {
    const body: Record<string, unknown> = {
      quoteId,
      userConfirmed: true,
      walletAddress,
    };
    if (options?.confirmationSignature) {
      body.confirmationSignature = options.confirmationSignature;
    }
    if (options?.acknowledgeUserPaidGas) {
      body.acknowledgeUserPaidGas = true;
    }
    return this.client.post<PrepareIntentResponse>("/v1/intents/prepare", body);
  }

  async getSigningInstructions(intentId: string): Promise<SigningInstructions> {
    const data = await this.client.get<{ instructions: SigningInstructions }>(
      `/v1/intents/${encodeURIComponent(intentId)}/signing`,
    );
    return data.instructions ?? (data as unknown as SigningInstructions);
  }

  async submitSignedIntent(
    intentId: string,
    signature: string,
    options?: { txHash?: string; walletAddress?: string },
  ): Promise<SubmitIntentResponse> {
    const body: Record<string, string> = { intentId, signature };
    if (options?.txHash) body.txHash = options.txHash;
    if (options?.walletAddress) body.walletAddress = options.walletAddress;
    const data = await this.client.post<{ result: SubmitIntentResponse }>("/v1/intents/submit", body);
    return data.result ?? (data as unknown as SubmitIntentResponse);
  }

  async getIntentStatus(intentId: string): Promise<Record<string, unknown>> {
    const data = await this.client.get<{ status: Record<string, unknown> }>(
      `/v1/intents/${encodeURIComponent(intentId)}`,
    );
    return data.status ?? (data as unknown as Record<string, unknown>);
  }

  async syncPermitSigner(
    intentId: string,
    signature: string,
    options?: { walletAddress?: string },
  ): Promise<SubmitIntentResponse> {
    const body: Record<string, string> = { intentId, signature };
    if (options?.walletAddress) body.walletAddress = options.walletAddress;
    const data = await this.client.post<{ result: SubmitIntentResponse }>(
      "/v1/intents/sync-permit-signer",
      body,
    );
    return data.result ?? (data as unknown as SubmitIntentResponse);
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

  private shouldResetAndRetry(err: unknown): boolean {
    return this.isSessionError(err) || isRetryableIntentMcpTransportError(err);
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
    return withIntentMcpTransportRetry(async () => {
      try {
        return await this.callToolOnce<T>(name, args);
      } catch (err) {
        if (this.shouldResetAndRetry(err)) {
          await this.resetConnection();
          return this.callToolOnce<T>(name, args);
        }
        throw err;
      }
    });
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

  async getGaslessSwapQuote(body: Record<string, unknown>): Promise<SanitizedQuote> {
    const data = await this.callTool<{ quote: SanitizedQuote }>("get_gasless_swap_quote", body);
    return data.quote;
  }

  async getQuoteConfirmation(quoteId: string, walletAddress: string): Promise<QuoteConfirmation> {
    return this.callTool<QuoteConfirmation>("get_quote_confirmation", {
      quoteId,
      walletAddress,
    });
  }

  async prepareIntent(
    quoteId: string,
    walletAddress: string,
    options?: { confirmationSignature?: string; acknowledgeUserPaidGas?: boolean },
  ): Promise<PrepareIntentResponse> {
    const args: Record<string, unknown> = {
      quoteId,
      userConfirmed: true,
      walletAddress,
    };
    if (options?.confirmationSignature) {
      args.confirmationSignature = options.confirmationSignature;
    }
    if (options?.acknowledgeUserPaidGas) {
      args.acknowledgeUserPaidGas = true;
    }
    return this.callTool<PrepareIntentResponse>("prepare_intent", args);
  }

  async getSigningInstructions(intentId: string): Promise<SigningInstructions> {
    const data = await this.callTool<Record<string, unknown>>("get_signing_instructions", { intentId });
    return unwrapInstructionsResponse(data);
  }

  async submitSignedIntent(
    intentId: string,
    signature: string,
    options?: { txHash?: string; walletAddress?: string },
  ): Promise<SubmitIntentResponse> {
    const args: Record<string, string> = { intentId, signature };
    if (options?.txHash) args.txHash = options.txHash;
    if (options?.walletAddress) args.walletAddress = options.walletAddress;
    const data = await this.callTool<Record<string, unknown>>("submit_signed_intent", args);
    return unwrapSubmitResponse(data);
  }

  async getIntentStatus(intentId: string): Promise<Record<string, unknown>> {
    const data = await this.callTool<Record<string, unknown>>("get_intent_status", { intentId });
    return unwrapStatusResponse(data);
  }

  async syncPermitSigner(
    intentId: string,
    signature: string,
    options?: { walletAddress?: string },
  ): Promise<SubmitIntentResponse> {
    const args: Record<string, string> = { intentId, signature };
    if (options?.walletAddress) args.walletAddress = options.walletAddress;
    const data = await this.callTool<Record<string, unknown>>("sync_permit_signer", args);
    return unwrapSubmitResponse(data);
  }
}

export function createIntentMcpSwapClient(config: IntentMcpConfig): IntentMcpSwapClient {
  if (config.transport === "mcp-remote") {
    return new RemoteMcpIntentSwapClient(config);
  }
  return new RestIntentMcpSwapClient(config);
}
