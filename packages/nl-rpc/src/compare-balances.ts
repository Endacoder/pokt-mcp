import {
  assertCompareChainCount,
  listChains,
  resolveChain,
  type PocketClient,
} from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { extractCompareChains } from "./compare-gas.js";
import { inferChain, normalizeQuery, resolveAddress } from "./patterns.js";

export type CompareBalanceEntry = {
  chain: string;
  chainName: string;
  symbol: string;
  balanceWei: string;
  balanceFormatted: string;
  error?: string;
};

export type CompareBalancesResult = {
  address: string;
  balances: CompareBalanceEntry[];
};

function formatNativeBalance(wei: bigint, symbol: string): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return `${whole} ${symbol}`;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fracStr} ${symbol}`;
}

export function isCompareBalancesQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (!/\bbalance(s)?\b/.test(q)) return false;
  return (
    /\bcompare\b/.test(q) ||
    /\bacross\b/.test(q) ||
    (/\bon\b/.test(q) && extractCompareChains(query).length >= 2)
  );
}

export function resolveCompareBalanceChains(query: string, context?: SessionContext): string[] {
  const explicit = extractCompareChains(query);
  if (explicit.length >= 2) return explicit.slice(0, 5);
  if (context?.defaultChain) {
    const fallback = inferChain(query, context);
    if (fallback && explicit.length === 1 && fallback !== explicit[0]) {
      return [explicit[0], fallback].slice(0, 5);
    }
  }
  return explicit.slice(0, 5);
}

export function matchCompareBalancesQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isCompareBalancesQuery(query)) return null;

  const address = resolveAddress(query, context);
  if (!address) {
    throw new Error(
      "NL_PARSE_FAILED: provide an address (0x…) to compare balances across chains.",
    );
  }

  const chains = resolveCompareBalanceChains(query, context);
  if (chains.length < 2) {
    throw new Error(
      "NL_PARSE_FAILED: name at least two chains to compare (e.g. eth, base, and arb-one).",
    );
  }

  assertCompareChainCount(chains.length);

  return {
    action: "read",
    chain: chains[0] ?? inferChain(query, context),
    method: "__compare_balances__",
    params: [address, chains],
    humanSummary: `Compare native balances for ${address} on ${chains.join(", ")}`,
    riskLevel: "none",
  };
}

export async function executeCompareBalances(
  pocket: PocketClient,
  address: string,
  chains: string[],
): Promise<CompareBalancesResult> {
  assertCompareChainCount(chains.length);

  const results = await Promise.all(
    chains.map(async (chainAlias) => {
      const info = resolveChain(chainAlias);
      if (!info) {
        return {
          chain: chainAlias,
          chainName: chainAlias,
          symbol: "",
          balanceWei: "0",
          balanceFormatted: "",
          error: `CHAIN_NOT_FOUND: ${chainAlias}`,
        } satisfies CompareBalanceEntry;
      }

      if (info.protocol !== "evm" && info.protocol !== "tron") {
        return {
          chain: info.slug,
          chainName: info.name,
          symbol: info.nativeSymbol,
          balanceWei: "0",
          balanceFormatted: "",
          error: `Unsupported protocol '${info.protocol}' for compare_balances (EVM only).`,
        } satisfies CompareBalanceEntry;
      }

      try {
        const resp = await pocket.rpc<string>(info.slug, "eth_getBalance", [address, "latest"]);
        const wei = BigInt(resp.result);
        return {
          chain: info.slug,
          chainName: info.name,
          symbol: info.nativeSymbol,
          balanceWei: wei.toString(),
          balanceFormatted: formatNativeBalance(wei, info.nativeSymbol),
        } satisfies CompareBalanceEntry;
      } catch (err) {
        return {
          chain: info.slug,
          chainName: info.name,
          symbol: info.nativeSymbol,
          balanceWei: "0",
          balanceFormatted: "",
          error: err instanceof Error ? err.message : String(err),
        } satisfies CompareBalanceEntry;
      }
    }),
  );

  return { address, balances: results };
}

export function formatCompareBalances(result: CompareBalancesResult): string {
  const lines = result.balances.map((entry) => {
    if (entry.error) return `- ${entry.chainName}: ${entry.error}`;
    return `- ${entry.chainName}: ${entry.balanceFormatted}`;
  });
  return `Native balances for ${result.address}:\n${lines.join("\n")}`;
}

/** Chains with explicit EVM mainnet coverage for open-ended scans. */
export function defaultCompareBalanceChains(): string[] {
  return listChains()
    .filter((chain) => chain.protocol === "evm" && chain.network === "mainnet" && chain.status !== "inactive")
    .slice(0, 5)
    .map((chain) => chain.slug);
}
