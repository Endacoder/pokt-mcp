import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { isVagueFollowUp } from "./context.js";
import {
  COINGECKO_PERIOD_FIELD,
  marketPeriodLabel,
  parseMarketTimePeriod,
  resolveMarketPeriod,
  type MarketTimePeriod,
} from "./pattern-lib/time-periods.js";
import { wantsGasPrice, normalizeQuery } from "./patterns.js";

/** CoinGecko coin id + display symbol for spot price lookups. */
const SPOT_ASSETS: Record<string, { coingeckoId: string; symbol: string }> = {
  eth: { coingeckoId: "ethereum", symbol: "ETH" },
  ethereum: { coingeckoId: "ethereum", symbol: "ETH" },
  btc: { coingeckoId: "bitcoin", symbol: "BTC" },
  bitcoin: { coingeckoId: "bitcoin", symbol: "BTC" },
  sol: { coingeckoId: "solana", symbol: "SOL" },
  solana: { coingeckoId: "solana", symbol: "SOL" },
  matic: { coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  pol: { coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  poly: { coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  polygon: { coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  avax: { coingeckoId: "avalanche-2", symbol: "AVAX" },
  avalanche: { coingeckoId: "avalanche-2", symbol: "AVAX" },
  bnb: { coingeckoId: "binancecoin", symbol: "BNB" },
  bsc: { coingeckoId: "binancecoin", symbol: "BNB" },
  ftm: { coingeckoId: "fantom", symbol: "FTM" },
  fantom: { coingeckoId: "fantom", symbol: "FTM" },
  celo: { coingeckoId: "celo", symbol: "CELO" },
  bera: { coingeckoId: "berachain", symbol: "BERA" },
  mnt: { coingeckoId: "mantle", symbol: "MNT" },
  mantle: { coingeckoId: "mantle", symbol: "MNT" },
  dai: { coingeckoId: "dai", symbol: "DAI" },
  usdc: { coingeckoId: "usd-coin", symbol: "USDC" },
  usdt: { coingeckoId: "tether", symbol: "USDT" },
  doge: { coingeckoId: "dogecoin", symbol: "DOGE" },
  dogecoin: { coingeckoId: "dogecoin", symbol: "DOGE" },
  link: { coingeckoId: "chainlink", symbol: "LINK" },
  chainlink: { coingeckoId: "chainlink", symbol: "LINK" },
  xrp: { coingeckoId: "ripple", symbol: "XRP" },
  ripple: { coingeckoId: "ripple", symbol: "XRP" },
};

const VS_CURRENCIES: Record<string, { vs: string; symbol: string }> = {
  usd: { vs: "usd", symbol: "USD" },
  dollar: { vs: "usd", symbol: "USD" },
  dollars: { vs: "usd", symbol: "USD" },
  usdt: { vs: "usd", symbol: "USD" },
  usdc: { vs: "usd", symbol: "USD" },
  btc: { vs: "btc", symbol: "BTC" },
  eth: { vs: "eth", symbol: "ETH" },
};

const VS_CURRENCY_ALIASES: Record<string, string> = {
  usdt: "usd",
  usdc: "usd",
};

const PRICE_CHANGE_PATTERNS = [
  /\b(?:avg(?:erage)?|percent(?:age)?|price)?\s*change\b.*\bin\s+([a-z0-9.-]+)\b.*\b(?:24\s*h(?:rs?|ours?)?|24h|last\s+day)\b/i,
  /\b([a-z0-9.-]+)\b.*\b(?:24\s*h(?:rs?|ours?)?|24h|last\s+day)\b.*\bchange\b/i,
  /\bhow\s+much\s+did\s+([a-z0-9.-]+)\b.*\b(?:move|change|drop|rise|gain|lose)\b.*\b(?:24\s*h(?:rs?|ours?)?|24h|today|last\s+day)\b/i,
  /\b([a-z0-9.-]+)\b.*\b(?:24\s*h(?:rs?|ours?)?|24h)\b.*\b(?:percent|pct|%)\b/i,
];

const SPOT_PRICE_PATTERNS = [
  /\b(?:what(?:'s| is)|how much is|current|(?:latest\s+)?)\s+(?:the\s+)?(?:price|value|worth)\s+(?:of\s+)?([a-z0-9.-]+)(?:\s+in\s+([a-z0-9.-]+))?\b/i,
  /\bwhat(?:'s| is)\s+([a-z0-9.-]+)\s+price\b/i,
  /\bprice\s+of\s+([a-z0-9.-]+)(?:\s+in\s+([a-z0-9.-]+))?\b/i,
  /\b([a-z0-9.-]+)\s+(?:token\s+)?price(?:\s+in\s+([a-z0-9.-]+))?\b/i,
  /\bhow much\s+(?:is\s+)?([a-z0-9.-]+)\s+(?:worth|cost)\b/i,
];

const PERFORMANCE_PATTERNS = [
  /\bhow\s+(?:has|is)\s+([a-z0-9.-]+)\s+been\s+doing\b/i,
  /\bhow\s+(?:has|is)\s+([a-z0-9.-]+)\s+doing\b/i,
  /\bhow(?:'s| is)\s+([a-z0-9.-]+)\s+performing\b/i,
  /\b([a-z0-9.-]+)\s+trend\b/i,
  /\b([a-z0-9.-]+)\s+(?:up\s+or\s+down|pump|dump|rally|correction)\b/i,
  /\b(?:is|has)\s+([a-z0-9.-]+)\s+(?:up|down|rising|falling|pumping|dumping)\b/i,
];

export type PriceChangePeriod = MarketTimePeriod;

export type PriceChangeResult = {
  symbol: string;
  coingeckoId: string;
  changePercent: number;
  currentPriceUsd: number;
  period: PriceChangePeriod;
};

/** @deprecated Use PriceChangeResult */
export type PriceChange24hResult = PriceChangeResult & { changePercent24h: number; period: "24h" };

export type SpotPriceResult = {
  asset: string;
  symbol: string;
  coingeckoId: string;
  vsCurrency: string;
  vsSymbol: string;
  price: number;
};

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAssetIndex(): Array<{ alias: string; asset: { coingeckoId: string; symbol: string } }> {
  const entries: Array<{ alias: string; asset: { coingeckoId: string; symbol: string } }> = [];

  for (const [alias, asset] of Object.entries(SPOT_ASSETS)) {
    entries.push({ alias, asset });
  }

  for (const chain of listChains()) {
    const sym = (chain.nativeSymbol ?? "").toLowerCase();
    if (sym && SPOT_ASSETS[sym]) {
      entries.push({ alias: sym, asset: SPOT_ASSETS[sym] });
    }
    for (const a of chain.aliases) {
      const alias = a.toLowerCase();
      if (SPOT_ASSETS[alias]) {
        entries.push({ alias, asset: SPOT_ASSETS[alias] });
      }
    }
    const slugAsset = SPOT_ASSETS[chain.slug.toLowerCase()];
    if (slugAsset) {
      entries.push({ alias: chain.slug.toLowerCase(), asset: slugAsset });
    }
  }

  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

function resolveSpotAsset(token: string): { coingeckoId: string; symbol: string } | null {
  const key = token.toLowerCase();
  if (SPOT_ASSETS[key]) return SPOT_ASSETS[key];

  const resolved = resolveChain(key);
  if (resolved) {
    // Polygon chain native asset is POL (ex-MATIC).
    if (resolved.slug === "poly") {
      return SPOT_ASSETS.pol;
    }
    const sym = resolved.nativeSymbol?.toLowerCase();
    if (sym && SPOT_ASSETS[sym]) return SPOT_ASSETS[sym];
    if (SPOT_ASSETS[resolved.slug.toLowerCase()]) return SPOT_ASSETS[resolved.slug.toLowerCase()];
  }

  return null;
}

/** Find the first known market asset mentioned in free text (longest alias wins). */
export function findSpotAssetInQuery(query: string): { coingeckoId: string; symbol: string } | null {
  const q = normalizeQuery(query);
  for (const { alias, asset } of buildAssetIndex()) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(q)) return asset;
  }
  return null;
}

export { resolveSpotAsset };

const COINGECKO_FALLBACK_IDS: Record<string, string[]> = {
  "polygon-ecosystem-token": ["matic-network"],
  "matic-network": ["polygon-ecosystem-token"],
};

function normalizeVsCurrency(vsCurrency: string): string {
  const key = vsCurrency.toLowerCase();
  return VS_CURRENCY_ALIASES[key] ?? key;
}

function extractFollowUpPart(query: string): string {
  const match = query.match(/Follow-up:\s*(.+?)(?:\s*\|\s*Context:|$)/i);
  return match?.[1]?.trim() ?? query;
}

function periodFromResolution(
  resolution: import("./pattern-lib/time-periods.js").MarketPeriodResolution | null,
): PriceChangePeriod | null {
  if (!resolution || resolution === "unmapped") return null;
  return resolution;
}

export function parsePriceChangePeriodFromContext(
  query: string,
  expandedQuery?: string,
): PriceChangePeriod | null {
  const fromQuery = periodFromResolution(resolveMarketPeriod(query));
  if (fromQuery) return fromQuery;
  if (!expandedQuery || expandedQuery === query) return null;
  return periodFromResolution(resolveMarketPeriod(extractFollowUpPart(expandedQuery)));
}

/** @deprecated Use parsePriceChangePeriodFromContext when expanded query may include assistant context. */
export function parsePriceChangePeriod(query: string): PriceChangePeriod | null {
  return periodFromResolution(resolveMarketPeriod(query));
}

function hasUnmappedMarketDuration(query: string): boolean {
  return resolveMarketPeriod(query) === "unmapped";
}

export function isUnmappedMarketDurationFollowUp(query: string, expandedQuery?: string): boolean {
  if (hasUnmappedMarketDuration(query)) return true;
  if (expandedQuery && expandedQuery !== query) {
    return hasUnmappedMarketDuration(extractFollowUpPart(expandedQuery));
  }
  return false;
}

export function formatUnsupportedMarketPeriodMessage(phrase: string, symbol: string): string {
  return [
    `CoinGecko does not provide a ${phrase.trim()} price change for ${symbol}.`,
    "Supported performance periods: 24h, 7d, 14d, 30d, and 1y.",
    "Try e.g. “in 7 days”, “in 24 hours”, or “last month”.",
  ].join("\n");
}

/** Vague market follow-up with a duration CoinGecko does not support (e.g. “in 3 days”). */
export function matchUnsupportedMarketPeriodQuery(
  query: string,
  expandedQuery?: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isUnmappedMarketDurationFollowUp(query, expandedQuery)) return null;
  if (!context?.lastMarketQuery && !isVagueFollowUp(query)) return null;

  const symbol = context?.lastMarketQuery?.symbol ?? "the asset";
  const phrase = extractFollowUpPart(expandedQuery ?? query);

  return {
    action: "read",
    chain: "eth",
    method: "__unsupported_market_period__",
    params: [phrase, symbol],
    humanSummary: `Explain unsupported market period for ${symbol}`,
    riskLevel: "none",
  };
}

function periodLabel(period: PriceChangePeriod): string {
  return marketPeriodLabel(period);
}

function buildPriceChangeIntent(
  chain: string,
  coingeckoId: string,
  symbol: string,
  period: PriceChangePeriod,
): RpcIntent {
  return {
    action: "read",
    chain,
    method: "__price_change__",
    params: [coingeckoId, symbol, period],
    humanSummary: `Get ${periodLabel(period)} price change for ${symbol}`,
    riskLevel: "none",
  };
}

export function isPriceChangeQuery(query: string): boolean {
  const q = normalize(query);
  const followUpPart = extractFollowUpPart(query);
  if (hasUnmappedMarketDuration(query) || hasUnmappedMarketDuration(followUpPart)) {
    return false;
  }
  if (parsePriceChangePeriod(query)) {
    if (/\bchange\b/.test(q) || /\b(?:move|gain|loss|drop|rise|doing)\b/.test(q)) return true;
    if (PERFORMANCE_PATTERNS.some((p) => p.test(query))) return true;
    if (isVagueFollowUp(query)) return true;
    for (const { alias } of buildAssetIndex()) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
      if (pattern.test(query)) return true;
    }
  }
  if (PERFORMANCE_PATTERNS.some((p) => p.test(query))) return true;
  if (!/\bchange\b/.test(q) && !/\b(?:move|gain|loss|drop|rise|trend|performing|pump|dump|rally|correction)\b/.test(q)) {
    return false;
  }
  return (
    /\b24\s*h(?:rs?|ours?)?\b/.test(q) ||
    /\b24h\b/.test(q) ||
    /\blast\s+day\b/.test(q) ||
    /\bpercent(?:age)?\b/.test(q) ||
    /\bpct\b/.test(q)
  );
}

function extractPriceChangeAsset(query: string): string | null {
  for (const pattern of PERFORMANCE_PATTERNS) {
    const match = query.match(pattern);
    const token = match?.[1]?.toLowerCase();
    if (token && resolveSpotAsset(token)) return token;
  }

  for (const pattern of PRICE_CHANGE_PATTERNS) {
    const match = query.match(pattern);
    const token = match?.[1]?.toLowerCase();
    if (token && resolveSpotAsset(token)) return token;
  }

  for (const { alias } of buildAssetIndex()) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (pattern.test(query) && isPriceChangeQuery(query)) {
      return alias;
    }
  }

  return null;
}

function extractAssetMention(query: string): string | null {
  for (const { alias } of buildAssetIndex()) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (pattern.test(query)) return alias;
  }
  return null;
}

function extractCrossAssetFromFollowUp(query: string, expandedQuery?: string): string | null {
  if (!isVagueFollowUp(query)) return null;
  const followUpPart = extractFollowUpPart(expandedQuery ?? query);
  return extractAssetMention(followUpPart);
}

export function matchPriceChangeFollowUp(
  query: string,
  chain: string,
  context?: SessionContext,
  expandedQuery?: string,
): RpcIntent | null {
  const last = context?.lastMarketQuery;
  if (!last) return null;

  const followUpPart = extractFollowUpPart(expandedQuery ?? query);
  if (hasUnmappedMarketDuration(query) || hasUnmappedMarketDuration(followUpPart)) {
    return null;
  }

  const period =
    parsePriceChangePeriodFromContext(query, expandedQuery) ??
    parsePriceChangePeriod(query);
  const vague = isVagueFollowUp(query);

  const crossAssetToken = extractCrossAssetFromFollowUp(query, expandedQuery);
  if (crossAssetToken) {
    const asset = resolveSpotAsset(crossAssetToken);
    if (asset) {
      const effectivePeriod = period ?? last.period ?? "24h";
      return buildPriceChangeIntent(chain, asset.coingeckoId, asset.symbol, effectivePeriod);
    }
  }

  if (!vague && !period) return null;

  const effectivePeriod = period ?? (vague ? last.period ?? "24h" : last.period ?? "24h");
  return buildPriceChangeIntent(chain, last.coingeckoId, last.symbol, effectivePeriod);
}

export function matchPriceChangeQuery(query: string, chain: string): RpcIntent | null {
  const performanceMatch = PERFORMANCE_PATTERNS.find((p) => p.test(query));
  if (performanceMatch) {
    const match = query.match(performanceMatch);
    const token = match?.[1]?.toLowerCase();
    const asset = token ? resolveSpotAsset(token) : null;
    if (asset) {
      const followUpPart = extractFollowUpPart(query);
      const period = parsePriceChangePeriod(followUpPart) ?? "24h";
      return buildPriceChangeIntent(chain, asset.coingeckoId, asset.symbol, period);
    }
  }

  if (!isPriceChangeQuery(query)) return null;

  const assetToken = extractPriceChangeAsset(query);
  if (!assetToken) return null;

  const asset = resolveSpotAsset(assetToken);
  if (!asset) return null;

  const followUpPart = extractFollowUpPart(query);
  if (hasUnmappedMarketDuration(followUpPart)) return null;
  let period = parsePriceChangePeriod(followUpPart);
  if (!period) {
    if (isVagueFollowUp(followUpPart)) return null;
    period = "24h";
  }
  return buildPriceChangeIntent(chain, asset.coingeckoId, asset.symbol, period);
}

function parseVsCurrency(raw?: string): { vs: string; symbol: string } {
  if (!raw) return VS_CURRENCIES.usd;
  const key = raw.toLowerCase();
  return VS_CURRENCIES[key] ?? VS_CURRENCIES.usd;
}

function extractSpotPriceQuery(query: string): { assetToken: string; vsToken?: string } | null {
  const q = normalize(query);
  if (wantsGasPrice(query)) return null;
  if (/\bgas\b/.test(q) && /\bprice\b/.test(q)) return null;

  for (const pattern of SPOT_PRICE_PATTERNS) {
    const match = q.match(pattern);
    if (!match) continue;
    const assetToken = match[1]?.toLowerCase();
    const vsToken = match[2]?.toLowerCase();
    if (!assetToken) continue;
    if (VS_CURRENCIES[assetToken] && !vsToken) continue;
    if (resolveSpotAsset(assetToken)) {
      return { assetToken, vsToken };
    }
  }

  for (const { alias } of buildAssetIndex()) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (pattern.test(q) && /\b(price|worth|value)\b/.test(q)) {
      return { assetToken: alias };
    }
  }

  return null;
}

export function matchSpotPriceQuery(query: string, chain: string): RpcIntent | null {
  const parsed = extractSpotPriceQuery(query);
  if (!parsed) return null;

  const asset = resolveSpotAsset(parsed.assetToken);
  if (!asset) return null;

  const vs = parseVsCurrency(parsed.vsToken);

  return {
    action: "read",
    chain,
    method: "__spot_price__",
    params: [asset.coingeckoId, asset.symbol, vs.vs, vs.symbol],
    humanSummary: `Get spot price of ${asset.symbol} in ${vs.symbol}`,
    riskLevel: "none",
  };
}

export function isSpotPriceQuery(query: string, chain = "eth"): boolean {
  return matchSpotPriceQuery(query, chain) !== null;
}

export async function fetchSpotPrice(
  coingeckoId: string,
  symbol: string,
  vsCurrency: string,
  vsSymbol: string,
): Promise<SpotPriceResult> {
  const normalizedVs = normalizeVsCurrency(vsCurrency);
  const displayVsSymbol =
    normalizedVs !== vsCurrency.toLowerCase() ? VS_CURRENCIES[normalizedVs]?.symbol ?? vsSymbol : vsSymbol;

  const idsToTry = [coingeckoId, ...(COINGECKO_FALLBACK_IDS[coingeckoId] ?? [])];
  let lastError: string | undefined;

  for (const id of idsToTry) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${normalizedVs}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        lastError = `Price lookup failed (${res.status})`;
        continue;
      }

      const json = (await res.json()) as Record<string, Record<string, number>>;
      const price = json[id]?.[normalizedVs];
      if (price === undefined) {
        lastError = `No ${displayVsSymbol} price returned for ${symbol}`;
        continue;
      }

      return {
        asset: symbol,
        symbol,
        coingeckoId: id,
        vsCurrency: normalizedVs,
        vsSymbol: displayVsSymbol,
        price,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError ?? `No ${displayVsSymbol} price returned for ${symbol}`);
}

const COINGECKO_PERIOD_FIELDS: Record<PriceChangePeriod, string> = COINGECKO_PERIOD_FIELD;

export async function fetchPriceChange(
  coingeckoId: string,
  symbol: string,
  period: PriceChangePeriod = "24h",
): Promise<PriceChangeResult> {
  const idsToTry = [coingeckoId, ...(COINGECKO_FALLBACK_IDS[coingeckoId] ?? [])];
  let lastError: string | undefined;
  const field = COINGECKO_PERIOD_FIELDS[period];

  for (const id of idsToTry) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        lastError = `Price change lookup failed (${res.status})`;
        continue;
      }

      const json = (await res.json()) as {
        market_data?: Record<string, number | { usd?: number } | undefined> & {
          current_price?: { usd?: number };
          price_change_percentage_24h?: number;
          price_change_percentage_7d?: number;
          price_change_percentage_30d?: number;
        };
      };

      const market = json.market_data;
      const changePercent = market?.[field as keyof typeof market] as number | undefined;

      const currentPriceUsd = market?.current_price?.usd;

      if (changePercent === undefined || currentPriceUsd === undefined) {
        lastError = `No ${periodLabel(period)} change data returned for ${symbol}`;
        continue;
      }

      return {
        symbol,
        coingeckoId: id,
        changePercent,
        currentPriceUsd,
        period,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError ?? `No ${periodLabel(period)} change data returned for ${symbol}`);
}

export async function fetchPriceChange24h(
  coingeckoId: string,
  symbol: string,
): Promise<PriceChange24hResult> {
  const result = await fetchPriceChange(coingeckoId, symbol, "24h");
  return {
    ...result,
    changePercent24h: result.changePercent,
    period: "24h",
  };
}

export function formatPriceChange(result: PriceChangeResult): string {
  const sign = result.changePercent >= 0 ? "+" : "";
  const price = formatSpotPrice(result.currentPriceUsd, "USD", "usd");
  return `${result.symbol} ${periodLabel(result.period)} change: ${sign}${result.changePercent.toFixed(2)}% (now ${price})`;
}

export function formatPriceChange24h(result: PriceChange24hResult): string {
  return formatPriceChange(result);
}

export function formatSpotPrice(price: number, vsSymbol: string, vsCurrency: string): string {
  const decimals = vsCurrency === "usd" ? 4 : 8;
  return `${price.toFixed(decimals).replace(/\.?0+$/, "")} ${vsSymbol}`;
}
