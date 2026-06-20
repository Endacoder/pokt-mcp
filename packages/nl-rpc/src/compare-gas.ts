import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { assessGasPrice, gweiFromHex } from "./gas-assessment.js";
import { normalizeQuery } from "./patterns.js";

export type CompareGasEntry = {
  chain: string;
  chainName: string;
  gwei: number;
  assessment: ReturnType<typeof assessGasPrice>;
};

export type CompareGasResult = {
  chains: CompareGasEntry[];
  cheaperChain?: string;
  cheaperChainName?: string;
};

/** Popular Pocket mainnets for open-ended “across chains” gas comparisons. */
export const DEFAULT_COMPARE_GAS_CHAINS = ["eth", "base", "arb-one", "poly", "opt", "avax"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chains mentioned in query, ordered by first appearance. */
export function extractCompareChains(query: string): string[] {
  const normalized = normalizeQuery(query);
  const found: Array<{ slug: string; index: number }> = [];

  for (const chain of listChains()) {
    if (chain.protocol !== "evm") continue;
    const keys = [chain.slug, chain.name ?? "", ...chain.aliases].filter(Boolean);
    let bestIndex: number | undefined;
    for (const key of keys) {
      const pattern = new RegExp(`\\b${escapeRegExp(key.toLowerCase())}\\b`, "i");
      const match = normalized.match(pattern);
      if (match?.index !== undefined && (bestIndex === undefined || match.index < bestIndex)) {
        bestIndex = match.index;
      }
    }
    if (bestIndex !== undefined) {
      found.push({ slug: chain.slug, index: bestIndex });
    }
  }

  found.sort((a, b) => a.index - b.index);
  const slugs: string[] = [];
  for (const entry of found) {
    if (!slugs.includes(entry.slug)) slugs.push(entry.slug);
  }
  return slugs;
}

export function wantsMultiChainGasCompare(query: string): boolean {
  const q = normalizeQuery(query);
  if (!/\bgas\b/.test(q)) return false;
  return (
    /\b(across|all|every)\s+chains?\b/.test(q) ||
    /\bon\s+all\s+(networks|blockchains)\b/.test(q) ||
    /\bevery\s+(network|blockchain)\b/.test(q) ||
    /\bmajor\s+(chains|networks|l2s?)\b/.test(q)
  );
}

export function isCompareGasQuery(query: string): boolean {
  const q = normalizeQuery(query);
  if (!/\bgas\b/.test(q)) return false;
  return (
    /\bcompare\b/.test(q) ||
    /\bvs\.?\b/.test(q) ||
    /\bversus\b/.test(q) ||
    wantsMultiChainGasCompare(query) ||
    (/\bon\b/.test(q) && extractCompareChains(query).length >= 2)
  );
}

export function resolveCompareGasChains(query: string): string[] {
  const explicit = extractCompareChains(query);
  if (explicit.length >= 2) return explicit;
  if (!isCompareGasQuery(query)) return [];
  if (explicit.length === 1) return [];
  if (wantsMultiChainGasCompare(query) || explicit.length === 0) {
    return DEFAULT_COMPARE_GAS_CHAINS.filter((slug) => resolveChain(slug)?.protocol === "evm");
  }
  return [];
}

export function matchCompareGasQuery(query: string, _context?: SessionContext): RpcIntent | null {
  const chains = resolveCompareGasChains(query);
  if (chains.length < 2) return null;

  const names = chains.map((slug) => resolveChain(slug)?.name ?? slug);
  return {
    action: "read",
    chain: chains[0]!,
    method: "__compare_gas__",
    params: chains,
    humanSummary: `Compare gas on ${names.join(", ")}`,
    riskLevel: "none",
  };
}

export async function executeCompareGas(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chains: string[],
): Promise<CompareGasResult> {
  const slugs = [...new Set(chains)];
  if (slugs.length < 2) {
    throw new Error("Gas comparison requires at least two EVM chains");
  }

  for (const slug of slugs) {
    const info = resolveChain(slug);
    if (!info || info.protocol !== "evm") {
      throw new Error(`Gas comparison requires EVM chains (got ${slug})`);
    }
  }

  const entries: CompareGasEntry[] = [];
  for (const slug of slugs) {
    const resp = await pocket.rpc<string>(slug, "eth_gasPrice", []);
    const gwei = gweiFromHex(resp.result);
    const chainInfo = resolveChain(slug)!;
    entries.push({
      chain: slug,
      chainName: chainInfo.name,
      gwei,
      assessment: assessGasPrice(gwei, slug),
    });
  }

  const sorted = [...entries].sort((x, y) => x.gwei - y.gwei);
  const cheapest = sorted[0];

  return {
    chains: entries,
    cheaperChain: cheapest?.chain,
    cheaperChainName: cheapest?.chainName,
  };
}

export function formatCompareGas(result: CompareGasResult): string {
  const lines = ["Gas comparison (via Pocket Network RPC):"];
  const sorted = [...result.chains].sort((a, b) => a.gwei - b.gwei);
  for (const entry of sorted) {
    lines.push(`· ${entry.chainName}: ${entry.gwei.toFixed(4)} gwei (${entry.assessment.levelLabel})`);
  }
  if (result.cheaperChainName && sorted.length >= 2) {
    const cheapest = sorted[0]!;
    const priciest = sorted[sorted.length - 1]!;
    if (cheapest.gwei !== priciest.gwei) {
      lines.push(`${cheapest.chainName} is cheapest right now.`);
    } else {
      lines.push("Gas prices are equal across compared chains.");
    }
  }
  return `\n${lines.join("\n")}`;
}
