import type { LlmConfig, RpcIntent } from "@pokt-mcp/shared";

const META_PATTERNS = [
  /\bwhat\s+model\b/i,
  /\bwha\s*t\s*model\b/i,
  /\bwhich\s+model\b/i,
  /\bwhat\s+llm\b/i,
  /\bwhat\s+ai\b/i,
  /\bmodel\s+are\s+you\b/i,
  /\bmodel\s+do\s+you\s+use\b/i,
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+are\s+you\b/i,
  /\bwhat\s+\S*model\S*\s+are\s+you\b/i,
  /\bwhat\s+\S+\s+are\s+you\s+using\b/i,
  /\bwhich\s+\S*model\S*\b/i,
];

const DATA_SOURCE_PATTERNS = [
  /\bcoingecko\b/i,
  /\bcoin\s*gecko\b/i,
  /\bchain\s+rpc\b/i,
  /\bpocket\s+(?:network\s+)?rpc\b/i,
  /\bwhat\s+api\b/i,
  /\bwhich\s+api\b/i,
  /\bdata\s+source\b/i,
  /\bwhere\s+do\s+(?:you|the\s+price)\s+.*\b(?:from|come)\b/i,
  /\b(?:using|use)\s+(?:the\s+)?(?:chain\s+)?rpc\s+or\b/i,
  /\brpc\s+or\s+(?:coingecko|coin\s*gecko|price\s+api)\b/i,
  /\bhow\s+do\s+you\s+get\s+(?:prices|price\s+data|market\s+data)\b/i,
];

const MODEL_TYPO_PATTERN = /\b(mdoel|modle|moedl)\b/i;

function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, " ")
    .replace(MODEL_TYPO_PATTERN, "model");
}

export function isMetaQuery(query: string): boolean {
  return matchMetaQuery(query) !== null;
}

export function matchMetaQuery(query: string): RpcIntent | null {
  const normalized = normalizeQuery(query);

  if (DATA_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      action: "read",
      chain: "eth",
      method: "__assistant_info__",
      params: ["data_sources"],
      humanSummary: "Explain data sources (RPC vs CoinGecko)",
      riskLevel: "none",
    };
  }

  if (!META_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return {
    action: "read",
    chain: "eth",
    method: "__assistant_info__",
    params: [],
    humanSummary: "Assistant and model information",
    riskLevel: "none",
  };
}

export function buildDataSourcesInfoMessage(): string {
  return [
    "pokt-mcp uses two data sources depending on the question:",
    "",
    "• On-chain data (blocks, gas, native balances, ERC-20 balances, transactions, contract calls) → Pocket Network RPC",
    "• Spot prices, 24h price change, and fiat/crypto conversion estimates → CoinGecko API (not chain RPC)",
    "",
    "Your BTC 24h change and spot price answers come from CoinGecko. Chain RPC cannot return market prices.",
  ].join("\n");
}

export function buildAssistantInfoMessage(config: LlmConfig | null): string {
  const lines = [
    "I'm the Pocket Network blockchain assistant.",
    "On-chain queries (blocks, balances, gas, transactions) use Pocket Network RPC.",
    "Spot prices, 24h change, and conversion estimates use CoinGecko — not chain RPC.",
  ];

  if (config?.enabled) {
    lines.push(`NL parsing fallback: ${config.provider} (${config.model}).`);
  } else {
    lines.push(
      "NL parsing is template-only (FEATURE_NL_LLM is off). Set FEATURE_NL_LLM=true and configure LLM_PROVIDER for broader queries.",
    );
  }

  return lines.join(" ");
}
