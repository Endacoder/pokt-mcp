import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { isPriceChangeQuery } from "./price.js";

/** CoinGecko id for each Pocket chain's native asset. */
const CHAIN_NATIVE_IDS: Record<string, string> = {
  eth: "ethereum",
  base: "ethereum",
  "arb-one": "ethereum",
  opt: "ethereum",
  scroll: "ethereum",
  blast: "ethereum",
  linea: "ethereum",
  zksync: "ethereum",
  fraxtal: "ethereum",
  poly: "polygon-ecosystem-token",
  avax: "avalanche-2",
  bsc: "binancecoin",
  gnosis: "xdai",
  fantom: "fantom",
  celo: "celo",
  bera: "berachain",
  mantle: "mantle",
  moonbeam: "moonbeam",
  kava: "kava",
  metis: "metis-token",
  solana: "solana",
};

const CHAIN_NATIVE_SYMBOLS: Record<string, string> = Object.fromEntries(
  listChains().map((c) => [c.slug, c.nativeSymbol ?? c.slug.toUpperCase()]),
);

/** Target asset aliases → CoinGecko vs_currencies key + display symbol. */
const TARGET_ASSETS: Record<
  string,
  { vs: string; symbol: string; decimals: number; crossCoingeckoId?: string }
> = {
  usd: { vs: "usd", symbol: "USD", decimals: 2 },
  dollar: { vs: "usd", symbol: "USD", decimals: 2 },
  dollars: { vs: "usd", symbol: "USD", decimals: 2 },
  btc: { vs: "btc", symbol: "BTC", decimals: 8 },
  bitcoin: { vs: "btc", symbol: "BTC", decimals: 8 },
  eth: { vs: "eth", symbol: "ETH", decimals: 6 },
  ethereum: { vs: "eth", symbol: "ETH", decimals: 6 },
  sol: { vs: "sol", symbol: "SOL", decimals: 6 },
  solana: { vs: "sol", symbol: "SOL", decimals: 6 },
  pol: { vs: "pol", symbol: "POL", decimals: 6, crossCoingeckoId: "polygon-ecosystem-token" },
  polygon: { vs: "pol", symbol: "POL", decimals: 6, crossCoingeckoId: "polygon-ecosystem-token" },
  matic: { vs: "pol", symbol: "POL", decimals: 6, crossCoingeckoId: "polygon-ecosystem-token" },
  avax: { vs: "avax", symbol: "AVAX", decimals: 6 },
  avalanche: { vs: "avax", symbol: "AVAX", decimals: 6 },
  bnb: { vs: "bnb", symbol: "BNB", decimals: 6 },
  bsc: { vs: "bnb", symbol: "BNB", decimals: 6 },
  ftm: { vs: "ftm", symbol: "FTM", decimals: 6 },
  fantom: { vs: "ftm", symbol: "FTM", decimals: 6 },
  celo: { vs: "celo", symbol: "CELO", decimals: 6 },
  xdai: { vs: "dai", symbol: "xDAI", decimals: 4 },
  gnosis: { vs: "dai", symbol: "xDAI", decimals: 4 },
  dai: { vs: "dai", symbol: "DAI", decimals: 4 },
  usdc: { vs: "usd", symbol: "USDC", decimals: 2 },
  usdt: { vs: "usd", symbol: "USDT", decimals: 2 },
  bera: { vs: "bera", symbol: "BERA", decimals: 6 },
  mnt: { vs: "mnt", symbol: "MNT", decimals: 6 },
  mantle: { vs: "mnt", symbol: "MNT", decimals: 6 },
};

const CONVERT_QUERY =
  /\b(in|worth in|value in|convert(?:ed)?\s+to|exchange(?:\s+rate)?\s+to)\s+(?!0x)([a-z0-9.-]+)\b|\bhow\s+much\b.*\bin\s+(?!0x)([a-z0-9.-]+)\b|what(?:'s| is)?\s+(?:that|it)\s+in\s+(?!0x)([a-z0-9.-]+)\b/i;

/** "how much USDT for 1 ETH", "1 ETH in USDC", etc. — spot estimate, not on-chain swap execution */
const TOKEN_QUOTE_QUERY =
  /\bhow\s+much\b\s+(usdt|usdc|dai|usd|btc|eth|sol|weth)\b.*\b(for|from)\b.*\b(\d+(?:\.\d+)?)\s*(?:eth|weth|native)\b|\bhow\s+much\b[^?]*\b(usdt|usdc|dai)\b[^?]*\b(?:for|get)\b[^?]*\b(\d+(?:\.\d+)?)\s*(?:eth|weth|native)\b|\b(\d+(?:\.\d+)?)\s*(?:eth|weth|native)\b.*\b(?:in|to|for|worth)\b\s*(usdt|usdc|dai|usd)\b/i;

const AMOUNT_PATTERN = /(\d+(?:\.\d+)?)\s*(?:eth|weth|native)\b/i;
const ADDRESS_PATTERN = /(0x[a-fA-F0-9]{40})/;

export type ConvertTarget = {
  key: string;
  vs: string;
  symbol: string;
  decimals: number;
  /** When set, convert via USD cross-rate between source and this CoinGecko id. */
  crossCoingeckoId?: string;
};

function nativeSymbol(chain: string): string {
  return CHAIN_NATIVE_SYMBOLS[chain] ?? "ETH";
}

function nativeCoingeckoId(chain: string): string | undefined {
  return CHAIN_NATIVE_IDS[chain];
}

/** Resolve target asset from query text (longest alias match). */
export function parseTargetAsset(query: string): ConvertTarget | null {
  const q = normalizeForMatch(query);
  const candidates: Array<{ alias: string; asset: ConvertTarget }> = [];

  for (const [alias, meta] of Object.entries(TARGET_ASSETS)) {
    candidates.push({
      alias,
      asset: {
        key: alias,
        vs: meta.vs,
        symbol: meta.symbol,
        decimals: meta.decimals,
        crossCoingeckoId: meta.crossCoingeckoId,
      },
    });
  }

  // Chain names from registry (e.g. "polygon" → matic)
  for (const chain of listChains()) {
    const slug = chain.slug;
    const sym = (chain.nativeSymbol ?? "").toLowerCase();
    if (sym && TARGET_ASSETS[sym]) {
      const meta = TARGET_ASSETS[sym];
      candidates.push({
        alias: sym,
        asset: {
          key: sym,
          vs: meta.vs,
          symbol: chain.nativeSymbol ?? meta.symbol,
          decimals: meta.decimals,
          crossCoingeckoId: meta.crossCoingeckoId,
        },
      });
    }
    for (const a of chain.aliases) {
      const alias = a.toLowerCase();
      if (TARGET_ASSETS[alias] || TARGET_ASSETS[sym]) {
        const meta = TARGET_ASSETS[alias] ?? TARGET_ASSETS[sym];
        candidates.push({
          alias,
          asset: {
            key: alias,
            vs: meta.vs,
            symbol: chain.nativeSymbol ?? meta.symbol,
            decimals: meta.decimals,
            crossCoingeckoId: meta.crossCoingeckoId,
          },
        });
      }
    }
    if (slug && !TARGET_ASSETS[slug]) {
      const resolved = resolveChain(slug);
      if (resolved?.nativeSymbol) {
        const s = resolved.nativeSymbol.toLowerCase();
        if (TARGET_ASSETS[s]) {
          const meta = TARGET_ASSETS[s];
          candidates.push({
            alias: slug,
            asset: {
              key: slug,
              vs: meta.vs,
              symbol: resolved.nativeSymbol,
              decimals: meta.decimals,
              crossCoingeckoId: meta.crossCoingeckoId,
            },
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, asset } of candidates) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (pattern.test(q)) {
      return asset;
    }
  }

  // Explicit capture groups from CONVERT_QUERY
  const match = q.match(CONVERT_QUERY);
  const token = match?.[2] ?? match?.[3] ?? match?.[4];
  if (token && TARGET_ASSETS[token.toLowerCase()]) {
    const meta = TARGET_ASSETS[token.toLowerCase()];
    return {
      key: token.toLowerCase(),
      vs: meta.vs,
      symbol: meta.symbol,
      decimals: meta.decimals,
      crossCoingeckoId: meta.crossCoingeckoId,
    };
  }

  return null;
}

function normalizeForMatch(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isConvertQuery(query: string): boolean {
  if (isPriceChangeQuery(query)) return false;
  const q = normalizeForMatch(query);
  return CONVERT_QUERY.test(q) || TOKEN_QUOTE_QUERY.test(q);
}

export function isTokenQuoteQuery(query: string): boolean {
  const q = normalizeForMatch(query);
  if (/\b(swap|trade)\b/.test(q)) return false;
  return TOKEN_QUOTE_QUERY.test(q) || (CONVERT_QUERY.test(q) && parseTargetAsset(query) !== null);
}

function buildConvertIntent(
  chain: string,
  value: string,
  mode: "address" | "wei",
  target: ConvertTarget,
  address?: string,
  summary?: string,
): RpcIntent {
  const params = address
    ? [chain, value, mode, target.vs, target.symbol, address]
    : [chain, value, mode, target.vs, target.symbol];
  return {
    action: "read",
    chain,
    method: "__native_convert__",
    params,
    humanSummary: summary ?? `Convert native balance to ${target.symbol}`,
    riskLevel: "none",
  };
}

export function matchConvertQuery(
  query: string,
  chain: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isConvertQuery(query)) return null;
  const target = parseTargetAsset(query);
  if (!target) return null;

  const addrMatch = query.match(ADDRESS_PATTERN);
  if (addrMatch) {
    return buildConvertIntent(
      chain,
      addrMatch[1],
      "address",
      target,
      undefined,
      `Convert balance to ${target.symbol} for ${addrMatch[1]} on ${chain}`,
    );
  }

  const amountMatch = query.match(AMOUNT_PATTERN);
  if (amountMatch) {
    const native = parseFloat(amountMatch[1]);
    const wei = `0x${BigInt(Math.floor(native * 1e18)).toString(16)}`;
    return buildConvertIntent(
      chain,
      wei,
      "wei",
      target,
      undefined,
      `Convert ${amountMatch[1]} native on ${chain} to ${target.symbol}`,
    );
  }

  if (context?.lastWalletPortfolio?.chains.length) {
    const portfolio = context.lastWalletPortfolio;
    return {
      action: "read",
      chain: portfolio.chains[0]?.chain ?? chain,
      method: "__wallet_portfolio_convert__",
      params: [portfolio, target.vs, target.symbol],
      humanSummary: `Convert wallet portfolio to ${target.symbol}`,
      riskLevel: "none",
    };
  }

  if (context?.lastBalance) {
    const { chain: balChain, address, wei } = context.lastBalance;
    return buildConvertIntent(
      balChain,
      wei,
      "wei",
      target,
      address,
      `Convert previous balance on ${balChain} to ${target.symbol}`,
    );
  }

  return null;
}

/** @deprecated */
export const matchFiatQuery = matchConvertQuery;
export const matchUsdQuery = matchConvertQuery;

export type ConvertResult = {
  chain: string;
  address?: string;
  nativeAmount: string;
  nativeSymbol: string;
  targetSymbol: string;
  targetVs: string;
  rate: number;
  convertedAmount: number;
  quoteType: "fiat" | "crypto";
};

export async function convertNativeAmount(
  chain: string,
  weiHex: string,
  targetVs: string,
  targetSymbol: string,
  address?: string,
): Promise<ConvertResult> {
  const sourceId = nativeCoingeckoId(chain);
  if (!sourceId) {
    throw new Error(`Conversion not supported for chain "${chain}" yet`);
  }

  const wei = BigInt(weiHex);
  const nativeAmount = Number(wei) / 1e18;

  const crossCoingeckoId =
    targetVs === "pol" || targetSymbol === "POL"
      ? TARGET_ASSETS.pol.crossCoingeckoId
      : undefined;

  let rate: number;
  if (crossCoingeckoId) {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${sourceId},${crossCoingeckoId}&vs_currencies=usd`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      throw new Error(`Price lookup failed (${res.status})`);
    }
    const json = (await res.json()) as Record<string, Record<string, number>>;
    const sourceUsd = json[sourceId]?.usd;
    const targetUsd = json[crossCoingeckoId]?.usd;
    if (sourceUsd === undefined || targetUsd === undefined || targetUsd === 0) {
      throw new Error(`No ${targetSymbol} rate returned for ${nativeSymbol(chain)} on ${chain}`);
    }
    rate = sourceUsd / targetUsd;
  } else {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${sourceId}&vs_currencies=${targetVs}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      throw new Error(`Price lookup failed (${res.status})`);
    }

    const json = (await res.json()) as Record<string, Record<string, number>>;
    const fetched = json[sourceId]?.[targetVs];
    if (fetched === undefined) {
      throw new Error(`No ${targetSymbol} rate returned for ${nativeSymbol(chain)} on ${chain}`);
    }
    rate = fetched;
  }

  const quoteType = targetVs === "usd" ? "fiat" : "crypto";

  return {
    chain,
    address,
    nativeAmount: nativeAmount.toFixed(6).replace(/\.?0+$/, "") || "0",
    nativeSymbol: nativeSymbol(chain),
    targetSymbol,
    targetVs,
    rate,
    convertedAmount: nativeAmount * rate,
    quoteType,
  };
}

/** @deprecated */
export async function convertNativeToFiat(
  chain: string,
  weiHex: string,
  currency: "usd" | "btc",
  address?: string,
) {
  const sym = currency.toUpperCase();
  const result = await convertNativeAmount(chain, weiHex, currency, sym, address);
  return {
    chain: result.chain,
    address: result.address,
    nativeAmount: result.nativeAmount,
    nativeSymbol: result.nativeSymbol,
    currency,
    fiatPrice: result.rate,
    fiatValue: result.convertedAmount,
  };
}

export function formatConvertedAmount(amount: number, targetSymbol: string, targetVs: string): string {
  const meta = Object.values(TARGET_ASSETS).find((m) => m.vs === targetVs && m.symbol === targetSymbol);
  const decimals = meta?.decimals ?? (targetVs === "usd" ? 2 : 8);
  if (decimals <= 2) return amount.toFixed(decimals);
  return amount.toFixed(decimals).replace(/\.?0+$/, "") || "0";
}
