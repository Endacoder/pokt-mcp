import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { inferChain, normalizeQuery, wantsBalance } from "./patterns.js";

export type CosmosBalance = {
  denom: string;
  amount: string;
};

export type CosmosBalanceResult = {
  chain: string;
  chainName: string;
  address: string;
  balances: CosmosBalance[];
};

const COSMOS_ADDRESS_PATTERN = /\b([a-z]{1,10}1[a-z0-9]{38,})\b/i;

function extractCosmosAddress(query: string): string | null {
  return query.match(COSMOS_ADDRESS_PATTERN)?.[1] ?? null;
}

export function isCosmosBalanceQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (!wantsBalance(q)) return false;
  const chain = inferChain(query);
  const info = resolveChain(chain);
  if (info?.protocol === "cosmos") return true;
  return /\b(osmosis|cosmos|juno|akash|pocket|pokt)\b/.test(q) && extractCosmosAddress(query) != null;
}

export function matchCosmosBalanceQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isCosmosBalanceQuery(query)) return null;

  const address = extractCosmosAddress(query);
  if (!address) {
    throw new Error("NL_PARSE_FAILED: provide a Cosmos bech32 address (e.g. cosmos1…, osmo1…).");
  }

  const chain = inferChain(query, context);
  const info = resolveChain(chain);
  if (!info || info.protocol !== "cosmos") {
    throw new Error(`NL_PARSE_FAILED: could not resolve a Cosmos chain from query (got '${chain}').`);
  }

  return {
    action: "read",
    chain: info.slug,
    method: "__cosmos_balance__",
    params: [info.slug, address],
    humanSummary: `Cosmos bank balances for ${address} on ${info.name}`,
    riskLevel: "none",
  };
}

export async function fetchCosmosBalances(
  chainAlias: string,
  address: string,
): Promise<CosmosBalanceResult> {
  const info = resolveChain(chainAlias);
  if (!info) {
    throw new Error(`CHAIN_NOT_FOUND: ${chainAlias}`);
  }
  if (info.protocol !== "cosmos") {
    throw new Error(`Expected cosmos chain, got '${info.protocol}' for ${chainAlias}`);
  }

  const url = `${info.endpoint}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`);
  }

  const json = (await response.json()) as { balances?: CosmosBalance[] };
  return {
    chain: info.slug,
    chainName: info.name,
    address,
    balances: json.balances ?? [],
  };
}

export function formatCosmosBalances(result: CosmosBalanceResult): string {
  if (result.balances.length === 0) {
    return `No balances found for ${result.address} on ${result.chainName}.`;
  }
  const lines = result.balances.map((b) => `- ${b.amount} ${b.denom}`);
  return `Balances for ${result.address} on ${result.chainName}:\n${lines.join("\n")}`;
}
