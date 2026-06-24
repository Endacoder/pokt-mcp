import { resolveChain } from "@pokt-mcp/pocket-client";
import { loadExplorerApiKey } from "./config.js";

export const EXPLORER_V2_BASE = "https://api.etherscan.io/v2/api";

export type ContractSourceResult = {
  address: string;
  contractName: string;
  compilerVersion: string;
  sourceCode: string;
  abi: string;
  proxy: string;
  implementation: string;
  verified: boolean;
};

export type TokenInfoResult = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
};

export type TokenHolder = {
  address: string;
  balance: string;
  sharePercent?: number;
};

async function explorerRequest<T>(
  chain: string,
  module: string,
  action: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<T> {
  const chainInfo = resolveChain(chain);
  const chainId = chainInfo?.chainId;
  if (!chainId) {
    throw new Error(`No chain ID configured for ${chain}`);
  }

  const url = new URL(EXPLORER_V2_BASE);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", module);
  url.searchParams.set("action", action);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Explorer API failed (${res.status})`);
  }

  const json = (await res.json()) as {
    status?: string;
    message?: string;
    result?: T | string;
  };

  if (json.status !== "1") {
    const msg = typeof json.result === "string" ? json.result : json.message;
    throw new Error(msg ?? "Explorer request failed");
  }

  return json.result as T;
}

export async function fetchContractSource(
  chain: string,
  address: string,
  apiKey?: string,
): Promise<ContractSourceResult | null> {
  const key = apiKey ?? loadExplorerApiKey();
  if (!key) return null;

  try {
    const rows = await explorerRequest<
      Array<{
        SourceCode: string;
        ABI: string;
        ContractName: string;
        CompilerVersion: string;
        Proxy: string;
        Implementation: string;
      }>
    >(chain, "contract", "getsourcecode", { address }, key);

    const row = rows[0];
    if (!row || row.ABI === "Contract source code not verified") {
      return {
        address,
        contractName: "",
        compilerVersion: "",
        sourceCode: "",
        abi: "",
        proxy: "0",
        implementation: "",
        verified: false,
      };
    }

    return {
      address,
      contractName: row.ContractName ?? "",
      compilerVersion: row.CompilerVersion ?? "",
      sourceCode: row.SourceCode ?? "",
      abi: row.ABI ?? "",
      proxy: row.Proxy ?? "0",
      implementation: row.Implementation ?? "",
      verified: true,
    };
  } catch {
    return null;
  }
}

export async function fetchTokenInfo(
  chain: string,
  address: string,
  apiKey?: string,
): Promise<TokenInfoResult | null> {
  const key = apiKey ?? loadExplorerApiKey();
  if (!key) return null;

  try {
    const rows = await explorerRequest<
      Array<{
        contractAddress: string;
        tokenName: string;
        symbol: string;
        divisor: string;
        totalSupply: string;
      }>
    >(chain, "token", "tokeninfo", { contractaddress: address }, key);

    const row = rows[0];
    if (!row) return null;

    return {
      address: row.contractAddress ?? address,
      name: row.tokenName ?? "",
      symbol: row.symbol ?? "",
      decimals: Number(row.divisor ?? 18),
      totalSupply: row.totalSupply ?? "0",
    };
  } catch {
    return null;
  }
}

export async function fetchTokenHolders(
  chain: string,
  address: string,
  limit = 10,
  apiKey?: string,
): Promise<TokenHolder[]> {
  const key = apiKey ?? loadExplorerApiKey();
  if (!key) return [];

  try {
    const rows = await explorerRequest<
      Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }>
    >(chain, "token", "tokenholderlist", { contractaddress: address, page: "1", offset: String(limit) }, key);

    const total = rows.reduce((sum, r) => sum + Number(r.TokenHolderQuantity || 0), 0);
    return rows.map((r) => ({
      address: r.TokenHolderAddress,
      balance: r.TokenHolderQuantity,
      sharePercent: total > 0 ? (Number(r.TokenHolderQuantity) / total) * 100 : undefined,
    }));
  } catch {
    return [];
  }
}

export async function fetchTokenTransfers(
  chain: string,
  address: string,
  limit = 50,
  apiKey?: string,
): Promise<
  Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    tokenSymbol: string;
    timeStamp?: string;
  }>
> {
  const key = apiKey ?? loadExplorerApiKey();
  if (!key) return [];

  try {
    const url = new URL(EXPLORER_V2_BASE);
    const chainInfo = resolveChain(chain);
    if (!chainInfo?.chainId) return [];

    url.searchParams.set("chainid", String(chainInfo.chainId));
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokentx");
    url.searchParams.set("address", address);
    url.searchParams.set("startblock", "0");
    url.searchParams.set("endblock", "99999999");
    url.searchParams.set("page", "1");
    url.searchParams.set("offset", String(limit));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("apikey", key);

    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      status?: string;
      result?: Array<{
        hash: string;
        from: string;
        to: string;
        value: string;
        tokenSymbol?: string;
        timeStamp?: string;
      }>;
    };

    if (json.status !== "1" || !Array.isArray(json.result)) return [];
    return json.result.map((r) => ({
      hash: r.hash,
      from: r.from,
      to: r.to,
      value: r.value,
      tokenSymbol: r.tokenSymbol ?? "?",
      timeStamp: r.timeStamp,
    }));
  } catch {
    return [];
  }
}

export function estimateGasFeesFromTxs(
  txs: Array<{ gasUsed?: string; gasPrice?: string; timeStamp?: string }>,
  daysBack = 90,
): { totalEth: number; txCount: number; periodDays: number } {
  const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400;
  let totalWei = 0n;
  let count = 0;

  for (const tx of txs) {
    if (tx.timeStamp && Number(tx.timeStamp) < cutoff) continue;
    const gasUsed = BigInt(tx.gasUsed ?? "0");
    const gasPrice = BigInt(tx.gasPrice ?? "0");
    if (gasUsed > 0n && gasPrice > 0n) {
      totalWei += gasUsed * gasPrice;
      count++;
    }
  }

  return {
    totalEth: Number(totalWei) / 1e18,
    txCount: count,
    periodDays: daysBack,
  };
}
