import { resolveChain } from "@pokt-mcp/pocket-client";

/** Unified Etherscan API V2 (multichain via chainid). */
export const EXPLORER_V2_BASE = "https://api.etherscan.io/v2/api";

export function loadExplorerApiKey(): string | undefined {
  return process.env.EXPLORER_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim() || undefined;
}

export function formatWeiToNative(weiHex: string, symbol: string): string {
  const wei = BigInt(weiHex || "0x0");
  const amount = Number(wei) / 1e18;
  return `${amount.toFixed(6).replace(/\.?0+$/, "") || "0"} ${symbol}`;
}

export function directionFor(address: string, from: string, to: string): "in" | "out" | "self" {
  const addr = address.toLowerCase();
  const f = from.toLowerCase();
  const t = (to ?? "").toLowerCase();
  if (f === addr && t === addr) return "self";
  if (f === addr) return "out";
  return "in";
}

export async function explorerAccountAction<T>(
  chain: string,
  action: string,
  address: string,
  apiKey: string,
  offset = 1000,
): Promise<T[]> {
  const chainInfo = resolveChain(chain);
  const chainId = chainInfo?.chainId;
  if (!chainId) {
    throw new Error(`No chain ID configured for ${chain}`);
  }

  const url = new URL(EXPLORER_V2_BASE);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", address);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Explorer API failed (${res.status})`);
  }

  const json = (await res.json()) as {
    status?: string;
    message?: string;
    result?: T[] | string;
  };

  if (json.status !== "1") {
    const msg = typeof json.result === "string" ? json.result : json.message;
    if (msg?.toLowerCase().includes("no transactions") || msg === "No transactions found") {
      return [];
    }
    throw new Error(msg ?? "Explorer request failed");
  }

  return Array.isArray(json.result) ? json.result : [];
}

export type ExplorerTxRow = {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp?: string;
};

export type ExplorerTokenTxRow = {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  tokenSymbol?: string;
  contractAddress?: string;
  timeStamp?: string;
};

export type ExplorerTokenHolding = {
  TokenAddress: string;
  TokenName: string;
  TokenSymbol: string;
  TokenQuantity: string;
  TokenDivisor: string;
  TokenPriceUSD?: string;
};

export async function fetchExplorerTxList(
  chain: string,
  address: string,
  limit: number,
  apiKey: string,
): Promise<ExplorerTxRow[]> {
  return explorerAccountAction<ExplorerTxRow>(chain, "txlist", address, apiKey, limit);
}

export async function fetchAddressTokenHoldings(
  chain: string,
  address: string,
  apiKey: string,
  offset = 100,
): Promise<ExplorerTokenHolding[]> {
  return explorerAccountAction<ExplorerTokenHolding>(chain, "addresstokenbalance", address, apiKey, offset);
}
