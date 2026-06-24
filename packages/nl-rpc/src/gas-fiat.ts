import { listChains, resolveChain, type PocketClient } from "@pokt-mcp/pocket-client";
import type { RpcIntent } from "@pokt-mcp/shared";
import { gweiFromHex } from "./gas-assessment.js";
import { normalizeQuery } from "./patterns.js";
import { fetchSpotPrice } from "./price.js";

/** Typical simple ETH transfer gas units (for context in answers). */
export const SIMPLE_TRANSFER_GAS = 21_000;

const CHAIN_NATIVE_IDS: Record<string, { coingeckoId: string; symbol: string }> = {
  eth: { coingeckoId: "ethereum", symbol: "ETH" },
  base: { coingeckoId: "ethereum", symbol: "ETH" },
  "arb-one": { coingeckoId: "ethereum", symbol: "ETH" },
  opt: { coingeckoId: "ethereum", symbol: "ETH" },
  scroll: { coingeckoId: "ethereum", symbol: "ETH" },
  blast: { coingeckoId: "ethereum", symbol: "ETH" },
  linea: { coingeckoId: "ethereum", symbol: "ETH" },
  zksync: { coingeckoId: "ethereum", symbol: "ETH" },
  fraxtal: { coingeckoId: "ethereum", symbol: "ETH" },
  poly: { coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  avax: { coingeckoId: "avalanche-2", symbol: "AVAX" },
  bsc: { coingeckoId: "binancecoin", symbol: "BNB" },
  gnosis: { coingeckoId: "xdai", symbol: "xDAI" },
  celo: { coingeckoId: "celo", symbol: "CELO" },
  fantom: { coingeckoId: "fantom", symbol: "FTM" },
  bera: { coingeckoId: "berachain", symbol: "BERA" },
  mantle: { coingeckoId: "mantle", symbol: "MNT" },
};

const FIAT_ALIASES: Record<string, { vs: string; symbol: string }> = {
  usd: { vs: "usd", symbol: "USD" },
  dollar: { vs: "usd", symbol: "USD" },
  dollars: { vs: "usd", symbol: "USD" },
  usdt: { vs: "usd", symbol: "USDT" },
  usdc: { vs: "usd", symbol: "USDC" },
  eur: { vs: "eur", symbol: "EUR" },
  euro: { vs: "eur", symbol: "EUR" },
  euros: { vs: "eur", symbol: "EUR" },
};

const GAS_FIAT_PATTERNS: RegExp[] = [
  /\bhow\s+much\s+in\s+(usdt|usdc|usd|dollars?|eur|euros?)\b.*\b(?:eth\s+)?gas\b/i,
  /\bhow\s+much\s+is\s+(?:eth\s+)?gas\b.*\bin\s+(usdt|usdc|usd|dollars?|eur|euros?)\b/i,
  /\b(?:eth\s+)?gas\b.*\bin\s+(usdt|usdc|usd|dollars?|eur|euros?)\b/i,
  /\bgas\b.*\b(?:price|cost|fee|worth|value)\b.*\bin\s+(usdt|usdc|usd|dollars?|eur|euros?)\b/i,
  /\bhow\s+much\s+(?:is\s+)?(?:eth\s+)?gas\b.*\b(?:worth|cost)\b/i,
];

function normalizeGasFiatQuery(query: string): string {
  return normalizeQuery(query).replace(/\bmush\b/g, "much");
}

function parseFiatTarget(query: string): { vs: string; symbol: string } {
  const q = normalizeGasFiatQuery(query);
  for (const [alias, meta] of Object.entries(FIAT_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(q)) {
      return meta;
    }
  }
  return { vs: "usd", symbol: "USDT" };
}

export function isGasFiatQuery(query: string): boolean {
  const q = normalizeGasFiatQuery(query);
  if (!/\bgas\b/.test(q)) return false;
  if (/\b(swap|trade|exchange)\b/.test(q)) return false;
  return GAS_FIAT_PATTERNS.some((pattern) => pattern.test(q));
}

export function matchGasFiatQuery(query: string, chain: string): RpcIntent | null {
  if (!isGasFiatQuery(query)) return null;
  const fiat = parseFiatTarget(query);
  const chainInfo = resolveChain(chain);
  return {
    action: "read",
    chain,
    method: "__gas_fiat__",
    params: [chain, fiat.vs, fiat.symbol],
    humanSummary: `Get gas price on ${chainInfo?.name ?? chain} in ${fiat.symbol}`,
    riskLevel: "none",
  };
}

export type GasFiatResult = {
  chain: string;
  chainName: string;
  nativeSymbol: string;
  gwei: number;
  gasPriceWei: string;
  nativePrice: number;
  fiatSymbol: string;
  fiatVs: string;
  /** Cost of 1 gas unit in fiat (wei price × native USD price / 1e18). */
  costPerGasUnitFiat: number;
  /** Estimated simple transfer (21k gas) in fiat. */
  costSimpleTransferFiat: number;
  simpleTransferGas: number;
  dataSource: string;
};

function nativeAsset(chain: string): { coingeckoId: string; symbol: string } {
  return CHAIN_NATIVE_IDS[chain] ?? CHAIN_NATIVE_IDS.eth!;
}

export async function executeGasFiat(
  pocket: PocketClient,
  chain: string,
  fiatVs: string,
  fiatSymbol: string,
): Promise<GasFiatResult> {
  const chainInfo = resolveChain(chain);
  const resp = await pocket.rpc(chain, "eth_gasPrice", []);
  const gasPriceWei = BigInt(String(resp.result));
  const gwei = gweiFromHex(String(resp.result));
  const native = nativeAsset(chain);
  const spot = await fetchSpotPrice(native.coingeckoId, native.symbol, fiatVs, fiatSymbol);

  const nativePerGasUnit = Number(gasPriceWei) / 1e18;
  const costPerGasUnitFiat = nativePerGasUnit * spot.price;
  const costSimpleTransferFiat = costPerGasUnitFiat * SIMPLE_TRANSFER_GAS;

  return {
    chain,
    chainName: chainInfo?.name ?? chain,
    nativeSymbol: chainInfo?.nativeSymbol ?? native.symbol,
    gwei,
    gasPriceWei: gasPriceWei.toString(),
    nativePrice: spot.price,
    fiatSymbol: spot.vsSymbol ?? fiatSymbol,
    fiatVs: spot.vsCurrency ?? fiatVs,
    costPerGasUnitFiat,
    costSimpleTransferFiat,
    simpleTransferGas: SIMPLE_TRANSFER_GAS,
    dataSource: "Pocket RPC (eth_gasPrice) + CoinGecko spot price",
  };
}

function formatFiatAmount(value: number, symbol: string): string {
  if (value >= 0.01) return `${value.toFixed(4)} ${symbol}`;
  if (value >= 0.0001) return `${value.toFixed(6)} ${symbol}`;
  return `${value.toExponential(3)} ${symbol}`;
}

export function formatGasFiat(result: GasFiatResult): string {
  const lines = [
    `Gas on ${result.chainName} (${result.chain}): ${result.gwei.toFixed(4)} gwei (via Pocket RPC).`,
    `${result.nativeSymbol} spot: $${result.nativePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${result.fiatSymbol}, CoinGecko).`,
    `Cost per gas unit: ${formatFiatAmount(result.costPerGasUnitFiat, result.fiatSymbol)}.`,
    `Estimated simple transfer (${result.simpleTransferGas.toLocaleString()} gas): ${formatFiatAmount(result.costSimpleTransferFiat, result.fiatSymbol)}.`,
    `Source: ${result.dataSource}.`,
  ];
  return `\n${lines.join("\n")}`;
}

export function listGasFiatChains(): string[] {
  return listChains().filter((c) => c.protocol === "evm").map((c) => c.slug);
}
