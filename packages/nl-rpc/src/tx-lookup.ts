import { resolveChain } from "@pokt-mcp/pocket-client";

const TX_LOOKUP_METHODS = new Set(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);

export function isTxLookupMethod(method: string): boolean {
  return TX_LOOKUP_METHODS.has(method);
}

export function extractTxHashFromParams(params: unknown[]): string | undefined {
  const hash = params[0];
  return typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash) ? hash : undefined;
}

export interface TxNotFoundInfo {
  found: false;
  hash: string;
  chain: string;
  chainName: string;
  method: string;
  message: string;
  explorerUrl?: string;
  suggestions: string[];
}

export function buildTxNotFoundInfo(chain: string, hash: string, method: string): TxNotFoundInfo {
  const chainInfo = resolveChain(chain);
  const chainName = chainInfo?.name ?? chain;
  const explorerBase = chainInfo?.blockExplorer?.replace(/\/$/, "");
  const explorerUrl = explorerBase ? `${explorerBase}/tx/${hash}` : undefined;
  const lookupKind = method === "eth_getTransactionReceipt" ? "receipt" : "transaction";

  const message =
    `No ${lookupKind} found for ${hash} on ${chainName}. ` +
    "The RPC returned null — this usually means the transaction does not exist on this chain, " +
    "has not been mined yet, or the hash may be incorrect.";

  const suggestions = [
    "Double-check the transaction hash for typos.",
    `Confirm the transaction was sent on ${chainName}, not another network.`,
    "If the transaction was just submitted, wait for confirmation and try again.",
  ];
  if (explorerUrl) {
    suggestions.push(`Check the block explorer: ${explorerUrl}`);
  }
  suggestions.push("Try other chains if this was a cross-chain transfer (e.g. base, arb-one, poly).");

  return {
    found: false,
    hash,
    chain,
    chainName,
    method,
    message,
    explorerUrl,
    suggestions,
  };
}

export function enrichTxLookupOutput(
  method: string,
  chain: string,
  params: unknown[],
  output: { result?: unknown; meta?: unknown },
): Record<string, unknown> {
  if (!isTxLookupMethod(method) || output.result != null) {
    return output as Record<string, unknown>;
  }
  const hash = extractTxHashFromParams(params);
  if (!hash) return output as Record<string, unknown>;

  const notFound = buildTxNotFoundInfo(chain, hash, method);
  return {
    ...output,
    result: null,
    notFound,
    message: notFound.message,
  };
}

export function formatTxNotFoundMessage(notFound: TxNotFoundInfo): string {
  return [
    notFound.message,
    "",
    "Possible reasons:",
    "- Wrong chain (transaction may be on a different network)",
    "- Typo in the transaction hash",
    "- Transaction not yet mined (still pending)",
    "",
    "Suggestions:",
    ...notFound.suggestions.map((s) => `- ${s}`),
  ].join("\n");
}

export function wantsTxExplain(query: string): boolean {
  const q = query.toLowerCase();
  return /\bexplain\b/.test(q) && /\b(tx|transaction)\b/.test(q);
}
