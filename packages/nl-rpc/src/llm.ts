import { listChains, listMethodsForProtocol } from "@pokt-mcp/pocket-client";
import type { LlmConfig, RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { formatKnownTokensForPrompt } from "./tokens.js";
import { parseJsonFromModelText } from "./parse-json.js";

const STATIC_RULES = `You parse blockchain natural language queries into RPC intents.
Return ONLY valid JSON matching this schema:
{
  "action": "read" | "write",
  "chain": "string slug e.g. eth, base, poly",
  "method": "JSON-RPC method e.g. eth_getBalance, eth_blockNumber",
  "params": [],
  "humanSummary": "short human-readable summary",
  "riskLevel": "none" | "low" | "high"
}
Rules:
- Prefer read actions unless the user explicitly asks to send or transfer tokens
- Never invent private keys or wallet secrets
- params must be a valid JSON-RPC params array
- For 24h price change (e.g. "BTC change in 24 hours", "avg change in eth last day"), use method "__price_change_24h__" with params [coingeckoId, symbol]
- For token/coin spot prices (e.g. "price of ETH", "how much is POL worth"), use method "__spot_price__" with params [coingeckoId, symbol, vsCurrency, vsSymbol] — use vsCurrency usd/btc/eth only (NOT usdt/usdc); never use eth_getBlockByNumber or other RPC for prices
- POLY/poly/polygon/matic refer to Polygon's native POL token (coingeckoId: polygon-ecosystem-token), not Polymath
- For ERC-20 token balances use eth_call with balanceOf(address) calldata: 0x70a08231 + padded address (32 bytes)
- For event logs use eth_getLogs with {address, fromBlock, toBlock, topics} filter object as a param
- For Solana chains use solana RPC methods (getBalance, getAccountInfo, etc.) not eth_* methods`;

let cachedPrompt: string | null = null;

export function buildLlmSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const chains = listChains();
  const chainLines = chains
    .map((c) => `- ${c.slug} (${c.name}, ${c.protocol}${c.chainId ? `, chainId ${c.chainId}` : ""})`)
    .join("\n");

  const evmMethods = listMethodsForProtocol("evm").join(", ");
  const solanaMethods = listMethodsForProtocol("solana").join(", ");

  cachedPrompt = `${STATIC_RULES}

Available chain slugs:
${chainLines}

Common EVM methods: ${evmMethods}
Common Solana methods: ${solanaMethods}

Known token contracts:
${formatKnownTokensForPrompt()}

Examples:
- "USDC balance of 0xabc on base" → eth_call on base with USDC contract and balanceOf calldata
- "recent Transfer events for 0xabc" → eth_getLogs with Transfer topic and address filter
- "SOL balance on solana" → getBalance on solana chain slug if available`;

  return cachedPrompt;
}

/** Reset cached prompt (for tests). */
export function resetLlmPromptCache(): void {
  cachedPrompt = null;
}

function formatSessionContext(context?: SessionContext): string {
  if (!context) return "";
  const parts: string[] = [];
  if (context.connectedAddress) {
    parts.push(`Connected wallet: ${context.connectedAddress}`);
  }
  if (context.lastBalance) {
    parts.push(
      `Last balance query: ${context.lastBalance.address} on ${context.lastBalance.chain} = ${context.lastBalance.wei} wei`,
    );
  }
  if (context.lastQuery) {
    parts.push(
      `Last query: ${context.lastQuery.method} on ${context.lastQuery.chain} (subject: ${context.lastQuery.subject})`,
    );
  }
  if (parts.length === 0) return "";
  return `\nSession context:\n${parts.join("\n")}`;
}

function isValidRpcIntent(value: unknown): value is RpcIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as RpcIntent;
  return (
    (intent.action === "read" || intent.action === "write") &&
    typeof intent.chain === "string" &&
    typeof intent.method === "string" &&
    Array.isArray(intent.params) &&
    typeof intent.humanSummary === "string" &&
    (intent.riskLevel === "none" || intent.riskLevel === "low" || intent.riskLevel === "high")
  );
}

export async function parseWithLlm(
  query: string,
  chain: string,
  config: LlmConfig,
  context?: SessionContext,
): Promise<RpcIntent | null> {
  const sessionBlock = formatSessionContext(context);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: buildLlmSystemPrompt() },
        {
          role: "user",
          content: `Default chain: ${chain}${sessionBlock}\nQuery: ${query}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 400 && /invalid model/i.test(body)) {
      throw new Error(
        `LLM model "${config.model}" is not available on ${config.provider}. Set LLM_MODEL (or LITELLM_MODEL) to a model your proxy supports — call ${config.baseUrl}/models to list options.`,
      );
    }
    throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseJsonFromModelText(content);
  } catch {
    return null;
  }
  if (!isValidRpcIntent(parsed)) {
    return null;
  }

  return parsed;
}
