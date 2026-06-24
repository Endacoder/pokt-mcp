import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { findSpotAssetInQuery } from "./price.js";
import { parseMarketTimePeriod } from "./pattern-lib/time-periods.js";
import { inferChain, normalizeQuery } from "./patterns.js";

export type MarketAnalyticsQueryType = "token_trading_volume" | "asset_trading_volume";

export type MarketAnalyticsUnsupportedResult = {
  message: string;
  suggestions: string[];
  chain: string;
  queryType: MarketAnalyticsQueryType;
};

export type AssetTradingVolumeResult = {
  symbol: string;
  coingeckoId: string;
  days: number;
  totalVolumeUsd: number;
  avgDailyVolumeUsd: number;
  latestVolumeUsd?: number;
  source: "coingecko";
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

const ASSET_VOLUME_PATTERNS = [
  /\b(?:trading\s+)?volume\s+of\s+trad(?:e|ing)\b/i,
  /\bvolume\s+of\s+trade\b/i,
  /\btrad(?:e|ing)\s+volume\b/i,
  /\b(?:how\s+much\s+)?(?:trading\s+)?volume\b/i,
];

function parseVolumeDays(query: string): number {
  const q = normalizeQuery(query);
  const explicit = q.match(/\b(?:last|past|over|in)\s+(\d+)\s+days?\b/);
  if (explicit) return Math.min(Math.max(parseInt(explicit[1], 10), 1), 90);

  const period = parseMarketTimePeriod(query);
  if (period === "24h") return 1;
  if (period === "7d") return 7;
  if (period === "14d") return 14;
  if (period === "30d") return 30;
  if (period === "1y") return 365;
  return 1;
}

function looksLikeAssetVolumeQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (ASSET_VOLUME_PATTERNS.some((pattern) => pattern.test(q))) return true;
  return /\bvolume\b/.test(q) && findSpotAssetInQuery(q) !== null;
}

export function matchAssetTradingVolumeQuery(
  query: string,
): RpcIntent | null {
  if (!looksLikeAssetVolumeQuery(query)) return null;

  const asset = findSpotAssetInQuery(query);
  if (!asset) return null;

  const days = parseVolumeDays(query);
  return {
    action: "read",
    chain: "eth",
    method: "__asset_trading_volume__",
    params: [asset.coingeckoId, asset.symbol, days],
    humanSummary: `${asset.symbol} trading volume over the last ${days} day(s)`,
    riskLevel: "none",
  };
}

export function matchMarketAnalyticsQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  const assetVolume = matchAssetTradingVolumeQuery(query);
  if (assetVolume) return assetVolume;

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

export function isMarketAnalyticsQuery(query: string): boolean {
  return matchMarketAnalyticsQuery(query) !== null;
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

function formatUsdVolume(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export async function fetchAssetTradingVolume(
  coingeckoId: string,
  symbol: string,
  days: number,
): Promise<AssetTradingVolumeResult> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Trading volume lookup failed (${res.status}) for ${symbol}`);
  }

  const json = (await res.json()) as { total_volumes?: Array<[number, number]> };
  const volumes = json.total_volumes ?? [];
  if (volumes.length === 0) {
    throw new Error(`No trading volume data returned for ${symbol}`);
  }

  const totalVolumeUsd = volumes.reduce((sum, [, volume]) => sum + volume, 0);
  const avgDailyVolumeUsd = totalVolumeUsd / days;
  const latestVolumeUsd = volumes[volumes.length - 1]?.[1];

  return {
    symbol,
    coingeckoId,
    days,
    totalVolumeUsd,
    avgDailyVolumeUsd,
    latestVolumeUsd,
    source: "coingecko",
  };
}

export function formatAssetTradingVolume(result: AssetTradingVolumeResult): string {
  const periodLabel = result.days === 1 ? "24 hours" : `${result.days} days`;
  const lines = [
    `${result.symbol} trading volume (CoinGecko, last ${periodLabel}):`,
    `• Total: ${formatUsdVolume(result.totalVolumeUsd)}`,
    `• Avg daily: ${formatUsdVolume(result.avgDailyVolumeUsd)}`,
  ];
  if (result.latestVolumeUsd != null) {
    lines.push(`• Latest snapshot: ${formatUsdVolume(result.latestVolumeUsd)}`);
  }
  lines.push("", "Source: aggregated exchange volume via CoinGecko (not on-chain DEX logs).");
  return lines.join("\n");
}
