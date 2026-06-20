import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { inferChain, normalizeQuery } from "./patterns.js";

export type MarketAnalyticsQueryType = "token_trading_volume";

export type MarketAnalyticsUnsupportedResult = {
  message: string;
  suggestions: string[];
  chain: string;
  queryType: MarketAnalyticsQueryType;
};

const TRADING_VOLUME_PATTERNS = [
  /\bmost\s+traded\b/i,
  /\bhighest\s+(?:trading\s+)?volume\b/i,
  /\btop\s+traded\b/i,
  /\bmost\s+swapped\b/i,
  /\bmost\s+active\s+token\b/i,
  /\bhighest\s+volume\s+token\b/i,
  /\btop\s+token\s+by\s+(?:trading\s+)?volume\b/i,
];

export function isMarketAnalyticsQuery(query: string): boolean {
  return matchMarketAnalyticsQuery(query) !== null;
}

export function matchMarketAnalyticsQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  const q = normalizeQuery(query);
  if (!TRADING_VOLUME_PATTERNS.some((pattern) => pattern.test(q))) {
    return null;
  }

  const chain = inferChain(query, context);
  const chainInfo = resolveChain(chain);
  const chainName = chainInfo?.name ?? chain;

  return {
    action: "read",
    chain,
    method: "__market_analytics_unsupported__",
    params: [chainName],
    humanSummary: `Explain trading-volume ranking limits on ${chainName}`,
    riskLevel: "none",
  };
}

export function buildMarketAnalyticsUnsupportedMessage(chainName: string): MarketAnalyticsUnsupportedResult {
  return {
    message: [
      `Chain-wide "most traded token" rankings (e.g. over the last 24 hours on ${chainName}) require indexed DEX or market data.`,
      "Pocket RPC can read blocks, balances, gas, and targeted ERC-20 transfer logs for a specific token and address (limited block range), but cannot rank all tokens on a chain by trading volume.",
    ].join(" "),
    suggestions: [
      "Recent USDC transfer events for 0x… (on-chain, specific token)",
      "Price of ETH in USD or 24h change for ETH (CoinGecko)",
      "Last 5 transactions on my account (explorer API, wallet connected)",
    ],
    chain: chainName,
    queryType: "token_trading_volume",
  };
}

export function formatMarketAnalyticsUnsupported(result: MarketAnalyticsUnsupportedResult): string {
  const lines = [result.message, "", "Try instead:"];
  for (const suggestion of result.suggestions) {
    lines.push(`• ${suggestion}`);
  }
  return lines.join("\n");
}

export function executeMarketAnalyticsUnsupported(chainName: string): MarketAnalyticsUnsupportedResult {
  return buildMarketAnalyticsUnsupportedMessage(chainName);
}
