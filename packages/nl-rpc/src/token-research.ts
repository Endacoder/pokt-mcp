import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import {
  fetchDexVolumeSummary,
  fetchTokenHolders,
  fetchTokenInfo,
  fetchTokenSecurity,
  loadExplorerApiKey,
} from "@pokt-mcp/integrations";
import { inferChain, normalizeQuery, extractAddress } from "./patterns.js";
import { fetchSpotPrice, fetchPriceChange } from "./price.js";
import { KNOWN_TOKENS, resolveKnownTokenAddress } from "./tokens.js";

export type TokenResearchResult = {
  chain: string;
  query: string;
  tokenAddress?: string;
  symbol?: string;
  name?: string;
  tokenInfo?: { name: string; symbol: string; decimals: number; totalSupply: string };
  spotPrice?: { price: number; vsSymbol: string };
  priceChange7d?: { changePercent: number; currentPriceUsd?: number };
  volume24h?: number;
  volumeChange1d?: number;
  topHolders: Array<{ address: string; balance: string; sharePercent?: number }>;
  safetyPreview?: { riskLevel: string; findings: Array<{ severity: string; message: string }> };
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
};

const TOKEN_SYMBOL_PATTERN = /\b([A-Z]{2,10})\b/;

export function isTokenResearchQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(research|analyze|analysis)\b.*\b(token|coin)\b/.test(q) ||
    /\bresearch\s+[a-z0-9]{2,10}\b/.test(q) ||
    /\btoken\s+research\b/.test(q) ||
    /\btop\s+holders?\b/.test(q) ||
    /\bvolume\s+trend\b/.test(q) ||
    /\bprice\s+history\b.*\b(token|coin)\b/.test(q) ||
    (/\bholders?\b/.test(q) && /\b(of|for)\b/.test(q))
  );
}

export function matchTokenResearchQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isTokenResearchQuery(query)) return null;

  const chain = inferChain(query, context);
  const address = extractAddress(query);
  const symbolMatch = query.match(TOKEN_SYMBOL_PATTERN);

  return {
    action: "read",
    chain,
    method: "__token_research__",
    params: [query, chain, address ?? symbolMatch?.[1] ?? ""],
    humanSummary: `Token research on ${chain}`,
    riskLevel: "none",
  };
}

export async function executeTokenResearch(
  _pocket: PocketClient,
  query: string,
  chain: string,
  tokenRef: string,
): Promise<TokenResearchResult> {
  const dataSources: TokenResearchResult["dataSources"] = {
    coingecko: "available",
    etherscan: loadExplorerApiKey() ? "available" : "skipped",
    defillama: "available",
    goplus: "available",
  };

  let tokenAddress = tokenRef.startsWith("0x") ? tokenRef : undefined;
  let symbol = !tokenAddress && tokenRef ? tokenRef.toUpperCase() : undefined;

  if (!tokenAddress && !symbol) {
    const sym = query.match(/\b(USDC|USDT|DAI|WETH|ETH|UNI|LINK|AAVE|PEPE|ARB|OP|MATIC|BNB)\b/i)?.[1];
    symbol = sym?.toUpperCase();
  }

  if (!tokenAddress && symbol) {
    tokenAddress = resolveKnownTokenAddress(chain, symbol);
  }

  let tokenInfo: TokenResearchResult["tokenInfo"];
  if (tokenAddress && loadExplorerApiKey()) {
    const info = await fetchTokenInfo(chain, tokenAddress);
    if (info) {
      tokenInfo = { name: info.name, symbol: info.symbol, decimals: info.decimals, totalSupply: info.totalSupply };
      symbol = info.symbol;
    }
  } else if (tokenAddress && symbol && KNOWN_TOKENS[chain]?.[symbol]) {
    const known = KNOWN_TOKENS[chain]![symbol]!;
    tokenInfo = {
      name: symbol,
      symbol,
      decimals: known.decimals,
      totalSupply: "",
    };
  }

  const spotSymbol = symbol ?? "ETH";
  let spotPrice: TokenResearchResult["spotPrice"];
  let priceChange7d: TokenResearchResult["priceChange7d"];

  const assetMap: Record<string, { id: string; sym: string }> = {
    eth: { id: "ethereum", sym: "ETH" },
    usdc: { id: "usd-coin", sym: "USDC" },
    usdt: { id: "tether", sym: "USDT" },
    dai: { id: "dai", sym: "DAI" },
    uni: { id: "uniswap", sym: "UNI" },
    link: { id: "chainlink", sym: "LINK" },
    aave: { id: "aave", sym: "AAVE" },
    pepe: { id: "pepe", sym: "PEPE" },
    arb: { id: "arbitrum", sym: "ARB" },
    op: { id: "optimism", sym: "OP" },
  };
  const asset = assetMap[(symbol ?? "eth").toLowerCase()] ?? {
    id: (symbol ?? "ethereum").toLowerCase(),
    sym: spotSymbol,
  };

  try {
    const spot = await fetchSpotPrice(asset.id, asset.sym, "usd", "USD");
    spotPrice = { price: spot.price ?? 0, vsSymbol: "USD" };
  } catch {
    dataSources.coingecko = "unavailable";
  }

  try {
    const change = await fetchPriceChange(asset.id, asset.sym, "7d");
    priceChange7d = { changePercent: change.changePercent ?? 0, currentPriceUsd: change.currentPriceUsd };
  } catch {
    /* optional */
  }

  const dexVol = await fetchDexVolumeSummary(chain);
  if (!dexVol.available) dataSources.defillama = "unavailable";

  let topHolders: TokenResearchResult["topHolders"] = [];
  if (tokenAddress) {
    topHolders = await fetchTokenHolders(chain, tokenAddress, 10);
    if (topHolders.length === 0 && dataSources.etherscan === "available") {
      dataSources.etherscan = "unavailable";
    }
  }

  let safetyPreview: TokenResearchResult["safetyPreview"];
  if (tokenAddress) {
    const sec = await fetchTokenSecurity(chain, tokenAddress);
    safetyPreview = { riskLevel: sec.riskLevel, findings: sec.findings };
    if (!sec.available) dataSources.goplus = "unavailable";
  }

  const holdersNote = (() => {
    if (topHolders.length > 0) return `Top ${topHolders.length} holders loaded.`;
    if (!tokenAddress) {
      return `Top holders: no known ${symbol ?? "token"} contract on ${chain} — provide contract address.`;
    }
    if (!loadExplorerApiKey()) {
      return "Top holders: set EXPLORER_API_KEY on the API server (Etherscan API V2).";
    }
    return "Top holders: explorer data unavailable for this token.";
  })();

  const summary = [
    `Token research for ${symbol ?? tokenAddress ?? "unknown"} on ${chain}.`,
    spotPrice ? `Spot: $${spotPrice.price.toLocaleString()} USD.` : "",
    priceChange7d ? `7d change: ${priceChange7d.changePercent >= 0 ? "+" : ""}${priceChange7d.changePercent.toFixed(2)}%.` : "",
    dexVol.available ? `DEX volume 24h (${chain}): $${dexVol.totalVolume24h.toLocaleString()}.` : "",
    holdersNote,
    safetyPreview ? `Safety: ${safetyPreview.riskLevel} risk.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    chain,
    query,
    tokenAddress,
    symbol,
    name: tokenInfo?.name,
    tokenInfo,
    spotPrice,
    priceChange7d,
    volume24h: dexVol.totalVolume24h,
    volumeChange1d: dexVol.change1d,
    topHolders,
    safetyPreview,
    dataSources,
    summary,
  };
}

export function formatTokenResearch(result: TokenResearchResult): string {
  const lines = [result.summary];
  if (result.topHolders.length > 0) {
    lines.push("\nTop holders:");
    for (const h of result.topHolders.slice(0, 5)) {
      lines.push(`• ${h.address.slice(0, 10)}… — ${h.sharePercent?.toFixed(2) ?? "?"}%`);
    }
  }
  if (result.safetyPreview?.findings.length) {
    lines.push("\nSafety flags:");
    for (const f of result.safetyPreview.findings) {
      lines.push(`• [${f.severity}] ${f.message}`);
    }
  }
  return lines.join("\n");
}
