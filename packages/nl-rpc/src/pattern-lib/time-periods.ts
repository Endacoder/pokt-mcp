import { normalizeQuery } from "./normalize.js";

export type MarketTimePeriod = "24h" | "7d" | "30d" | "14d" | "1y";

const PERIOD_24H =
  /\b(?:24\s*h(?:rs?|ours?)?|24h|in\s+24\s+hours?|last\s+day|past\s+day|today|since\s+yesterday|since\s+open)\b/;

const PERIOD_7D =
  /\b(?:7\s*d(?:ays?)?|last\s+week|past\s+week|over\s+(?:the\s+)?(?:last|past)\s+week|in\s+(?:1|a|one)\s+weeks?|in\s+7\s+days?|this\s+week|for\s+(?:the\s+)?week|(?:the|a)\s+week|past\s+7\s+days?|last\s+7\s+days?)\b/;

const PERIOD_14D =
  /\b(?:14\s*d(?:ays?)?|past\s+14\s+days?|last\s+14\s+days?|in\s+(?:2|two)\s+weeks?|in\s+14\s+days?|two\s+weeks?|past\s+two\s+weeks?)\b/;

const PERIOD_30D =
  /\b(?:30\s*d(?:ays?)?|last\s+month|past\s+month|over\s+(?:the\s+)?(?:last|past)\s+month|in\s+(?:1|a|one|\d+)\s+months?|in\s+30\s+days?|this\s+month|for\s+(?:the\s+)?month|(?:the|a)\s+month|past\s+30\s+days?)\b/;

const PERIOD_1Y =
  /\b(?:1\s*y(?:r|ear)?s?|in\s+(?:1|a|one|\d+)\s+years?|past\s+year|last\s+year|this\s+year|ytd|year\s+to\s+date|over\s+(?:the\s+)?year)\b/;

/** Market % change periods (not point-in-time RPC lookups). */
export function parseMarketTimePeriod(query: string): MarketTimePeriod | null {
  const q = normalizeQuery(query);
  if (PERIOD_24H.test(q)) return "24h";
  if (PERIOD_7D.test(q)) return "7d";
  if (PERIOD_14D.test(q)) return "14d";
  if (PERIOD_30D.test(q)) return "30d";
  if (PERIOD_1Y.test(q)) return "1y";
  return null;
}

export function marketPeriodLabel(period: MarketTimePeriod): string {
  if (period === "24h") return "24h";
  if (period === "7d") return "7d";
  if (period === "14d") return "14d";
  if (period === "30d") return "30d";
  return "1y";
}

/** CoinGecko market_data field for each period. */
export const COINGECKO_PERIOD_FIELD: Record<MarketTimePeriod, string> = {
  "24h": "price_change_percentage_24h",
  "7d": "price_change_percentage_7d",
  "14d": "price_change_percentage_14d",
  "30d": "price_change_percentage_30d",
  "1y": "price_change_percentage_1y",
};

export type MarketPeriodResolution = MarketTimePeriod | "unmapped";

/**
 * Resolve market period from query, including explicit "in N days/hours".
 * Returns "unmapped" when the user names a duration CoinGecko does not support (e.g. "in 3 days").
 */
export function resolveMarketPeriod(query: string): MarketPeriodResolution | null {
  const q = normalizeQuery(query);

  const inDays = q.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) {
    const n = parseInt(inDays[1], 10);
    if (n <= 1) return "24h";
    if (n === 7) return "7d";
    if (n === 14) return "14d";
    if (n === 30) return "30d";
    return "unmapped";
  }

  const inHours = q.match(/\bin\s+(\d+)\s+hours?\b/);
  if (inHours) {
    const n = parseInt(inHours[1], 10);
    if (n === 24) return "24h";
    return "unmapped";
  }

  return parseMarketTimePeriod(query);
}
