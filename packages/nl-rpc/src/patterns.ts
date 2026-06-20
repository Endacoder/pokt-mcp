import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { SessionContext } from "@pokt-mcp/shared";

export const ADDRESS_PATTERN = /(0x[a-fA-F0-9]{40}|[a-zA-Z0-9-]+\.eth)/;
export const TX_HASH_PATTERN = /(0x[a-fA-F0-9]{64})/;
export const BLOCK_NUM_PATTERN = /block\s+(?:#?(\d+)|number\s+(\d+)|at\s+(\d+))/i;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extractAddress(query: string): string | null {
  return query.match(ADDRESS_PATTERN)?.[1] ?? null;
}

export function extractTxHash(query: string): string | null {
  return query.match(TX_HASH_PATTERN)?.[1] ?? null;
}

export function extractBlockNumber(query: string): string | null {
  const match = query.match(BLOCK_NUM_PATTERN);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

export function resolveAddress(query: string, context?: SessionContext): string | null {
  const explicit = extractAddress(query);
  if (explicit) return explicit;
  if (wantsMyWallet(query)) {
    return context?.connectedAddress ?? context?.lastBalance?.address ?? null;
  }
  return context?.connectedAddress ?? context?.lastBalance?.address ?? null;
}

/** Match chain slugs/aliases mentioned anywhere in the query. */
export function inferChain(query: string, context?: SessionContext): string {
  const normalized = normalizeQuery(query);

  const aliases: Array<{ key: string; slug: string }> = [];
  for (const chain of listChains()) {
    aliases.push({ key: chain.slug.toLowerCase(), slug: chain.slug });
    for (const alias of chain.aliases) {
      aliases.push({ key: alias.toLowerCase(), slug: chain.slug });
    }
    if (chain.name) {
      aliases.push({ key: chain.name.toLowerCase(), slug: chain.slug });
    }
  }
  aliases.sort((a, b) => b.key.length - a.key.length);

  for (const { key, slug } of aliases) {
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\b`, "i");
    if (pattern.test(normalized)) {
      return slug;
    }
  }

  const onMatch = normalized.match(
    /\b(?:on|for|from|in)\s+([a-z0-9-]+)\b/,
  );
  if (onMatch) {
    const resolved = resolveChain(onMatch[1]);
    if (resolved) return resolved.slug;
  }

  return context?.defaultChain ?? context?.lastBalance?.chain ?? "eth";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wantsListChains(query: string): boolean {
  const q = normalizeQuery(query);
  if (wantsMyWallet(query) && wantsBalance(query)) return false;
  if (/\bmy\b/.test(q) && /\bbalances?\b/.test(q) && /\b(across|all|every)\s+chains?\b/.test(q)) {
    return false;
  }
  if (/\b(token|traded|trading|volume|swap|dex)\b/.test(q)) return false;
  if (/\bon\s+\w[\w-]*\s+chain\b/.test(q)) return false;
  return (
    /\b(list|show|display|get|all|what|which|supported|available|pocket)\b.*\bchains\b/.test(q) ||
    /\bchains\b.*\b(list|supported|available|networks?|pocket)\b/.test(q) ||
    /\bpocket\s+networks?\b/.test(q) ||
    /\bwhat\s+chains\s+(are|is)\s+(supported|available)\b/.test(q)
  );
}

export function wantsLatestBlock(query: string): boolean {
  const q = normalizeQuery(query);
  if (extractBlockNumber(query)) return false;
  return (
    /\b(latest|current|recent|newest|head)\b.*\bblock\b/.test(q) ||
    /\bblock\b.*\b(height|number|latest|current|now)\b/.test(q) ||
    /\bhow\s+high\b.*\bblock\b/.test(q) ||
    /\bblockchain\s+height\b/.test(q)
  );
}

export function wantsGasPrice(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bgas\s+price\b/.test(q) ||
    /\b(current|latest)\s+gas\b/.test(q) ||
    /\bgas\s+(cost|fee|rate)\b/.test(q) ||
    /\b(gwei|gas)\b.*\b(price|cost|rate)\b/.test(q) ||
    /\bhow\s+much\s+is\s+gas\b/.test(q)
  );
}

export function wantsBalance(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bbalances?\b/.test(q) ||
    /\bhow\s+much\b.*\b(hold|have|own)\b/.test(q) ||
    /\b(holdings|funds|wallet)\b/.test(q) ||
    /\baccount\s+balance\b/.test(q)
  );
}

export function wantsMyWallet(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bmy\b.*\b(wallet|balances?|account|funds|holdings)\b/.test(q) ||
    /\bmy balances?\b/.test(q) ||
    /\bconnected wallet\b/.test(q) ||
    /\bwhat(?:'s| is)\s+my\b.*\b(balances?|wallet)\b/.test(q)
  );
}

export function wantsMultiChainWalletBalance(query: string): boolean {
  const q = normalizeQuery(query);
  if (!wantsMyWallet(query) || !wantsBalance(query)) return false;
  return (
    /\b(across|all|every)\s+chains?\b/.test(q) ||
    /\bon\s+all\s+(networks|blockchains)\b/.test(q) ||
    /\bevery\s+(network|blockchain)\b/.test(q)
  );
}

export function wantsChainId(query: string): boolean {
  const q = normalizeQuery(query);
  return /\bchain\s*id\b/.test(q) || /\bnetwork\s*id\b/.test(q);
}

export function wantsNonce(query: string): boolean {
  const q = normalizeQuery(query);
  return /\bnonce\b/.test(q) || /\btransaction\s+count\b/.test(q);
}

export function wantsTxLookup(query: string): boolean {
  const q = normalizeQuery(query);
  const hash = extractTxHash(query);
  if (!hash) return false;
  return /\b(tx|transaction|hash|transfer)\b/.test(q) || q.includes(hash.slice(0, 10));
}

export function wantsReceipt(query: string): boolean {
  const q = normalizeQuery(query);
  const hash = extractTxHash(query);
  return !!hash && /\breceipt\b/.test(q);
}

export function wantsContractCode(query: string): boolean {
  const q = normalizeQuery(query);
  return /\b(contract\s+code|bytecode|get\s+code)\b/.test(q) && !!extractAddress(query);
}

export function isContractCodeQuery(query: string): boolean {
  return wantsContractCode(query);
}

export function wantsNetVersion(query: string): boolean {
  const q = normalizeQuery(query);
  return /\bnet\s*version\b/.test(q) || /\bnetwork\s+version\b/.test(q);
}

export function wantsSyncing(query: string): boolean {
  const q = normalizeQuery(query);
  return /\b(sync|syncing|synced)\b/.test(q) && /\b(node|network|chain|status)\b/.test(q);
}


export function wantsLatestSlot(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    (/\b(latest|current|recent)\b.*\bslot\b/.test(q) ||
      /\bslot\b.*\b(number|height|latest|current)\b/.test(q)) &&
    (/\bsolana\b/.test(q) || /\bsol\b/.test(q))
  );
}

export function extractSolanaAddress(query: string): string | null {
  const match = query.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
  if (!match) return null;
  if (match[1].startsWith("0x")) return null;
  return match[1];
}

export function wantsSolanaBalance(query: string): boolean {
  const q = normalizeQuery(query);
  if (!extractSolanaAddress(query)) return false;
  return (
    (/\bsol\b.*\bbalance\b/.test(q) || /\bbalance\b.*\bsol\b/.test(q)) &&
    (/\bsolana\b/.test(q) || /\bsol\b/.test(q))
  );
}

export function wantsSend(query: string): { amount: number; to: string } | null {
  const match = query.match(
    /(?:send|transfer|pay)\s+([\d.]+)\s*(?:eth|matic|avax|bnb|bera|xdai|ftm|native|tokens?)?\s*(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
  );
  if (!match) return null;
  return { amount: parseFloat(match[1]), to: match[2] };
}

export function intent(
  chain: string,
  method: string,
  params: unknown[],
  humanSummary: string,
  action: "read" | "write" = "read",
  riskLevel: "none" | "low" | "high" = "none",
) {
  return { action, chain, method, params, humanSummary, riskLevel };
}
