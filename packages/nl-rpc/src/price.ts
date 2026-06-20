import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent } from "@pokt-mcp/shared";
import { wantsGasPrice } from "./patterns.js";

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

export type PriceChange24hResult = {
  symbol: string;
  coingeckoId: string;
  changePercent24h: number;
  currentPriceUsd: number;
  period: "24h";
};

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

const COINGECKO_FALLBACK_IDS: Record<string, string[]> = {
  "polygon-ecosystem-token": ["matic-network"],
  "matic-network": ["polygon-ecosystem-token"],
};

function normalizeVsCurrency(vsCurrency: string): string {
  const key = vsCurrency.toLowerCase();
  return VS_CURRENCY_ALIASES[key] ?? key;
}

export function isPriceChangeQuery(query: string): boolean {
  const q = normalize(query);
  if (!/\bchange\b/.test(q) && !/\b(?:move|gain|loss|drop|rise)\b/.test(q)) return false;
  return (
    /\b24\s*h(?:rs?|ours?)?\b/.test(q) ||
    /\b24h\b/.test(q) ||
    /\blast\s+day\b/.test(q) ||
    /\bpercent(?:age)?\b/.test(q) ||
    /\bpct\b/.test(q)
  );
}

function extractPriceChangeAsset(query: string): string | null {
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

export function matchPriceChangeQuery(query: string, chain: string): RpcIntent | null {
  if (!isPriceChangeQuery(query)) return null;

  const assetToken = extractPriceChangeAsset(query);
  if (!assetToken) return null;

  const asset = resolveSpotAsset(assetToken);
  if (!asset) return null;

  return {
    action: "read",
    chain,
    method: "__price_change_24h__",
    params: [asset.coingeckoId, asset.symbol],
    humanSummary: `Get 24h price change for ${asset.symbol}`,
    riskLevel: "none",
  };
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

export async function fetchPriceChange24h(
  coingeckoId: string,
  symbol: string,
): Promise<PriceChange24hResult> {
  const idsToTry = [coingeckoId, ...(COINGECKO_FALLBACK_IDS[coingeckoId] ?? [])];
  let lastError: string | undefined;

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
        market_data?: {
          price_change_percentage_24h?: number;
          current_price?: { usd?: number };
        };
      };

      const changePercent24h = json.market_data?.price_change_percentage_24h;
      const currentPriceUsd = json.market_data?.current_price?.usd;

      if (changePercent24h === undefined || currentPriceUsd === undefined) {
        lastError = `No 24h change data returned for ${symbol}`;
        continue;
      }

      return {
        symbol,
        coingeckoId: id,
        changePercent24h,
        currentPriceUsd,
        period: "24h",
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError ?? `No 24h change data returned for ${symbol}`);
}

export function formatPriceChange24h(result: PriceChange24hResult): string {
  const sign = result.changePercent24h >= 0 ? "+" : "";
  const price = formatSpotPrice(result.currentPriceUsd, "USD", "usd");
  return `${result.symbol} 24h change: ${sign}${result.changePercent24h.toFixed(2)}% (now ${price})`;
}

export function formatSpotPrice(price: number, vsSymbol: string, vsCurrency: string): string {
  const decimals = vsCurrency === "usd" ? 4 : 8;
  return `${price.toFixed(decimals).replace(/\.?0+$/, "")} ${vsSymbol}`;
}
