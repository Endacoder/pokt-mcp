import { resolveChain } from "@pokt-mcp/pocket-client";
import type { PocketClient } from "@pokt-mcp/pocket-client";

const TX_LOOKUP_METHODS = new Set(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);

export const DEFAULT_TX_POLL_TIMEOUT_MS = 60_000;
export const DEFAULT_TX_POLL_INTERVAL_MS = 2_000;

export function loadTxPollTimeoutMs(): number {
  const raw = process.env.TX_LOOKUP_POLL_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TX_POLL_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TX_POLL_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPendingTransaction(tx: unknown): boolean {
  if (!tx || typeof tx !== "object") return false;
  const blockNumber = (tx as { blockNumber?: string | null }).blockNumber;
  return blockNumber == null || blockNumber === "0x" || blockNumber === "0x0";
}

export type TxLookupPollResult = {
  result: unknown;
  meta?: unknown;
  polled: boolean;
  waitedMs: number;
  pollAttempts: number;
  pending?: boolean;
};

export async function pollTxLookup(
  pocket: PocketClient,
  chain: string,
  hash: string,
  method: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<TxLookupPollResult> {
  if (!isTxLookupMethod(method)) {
    const resp = await pocket.rpc(chain, method, [hash]);
    return {
      result: resp.result,
      meta: resp.meta,
      polled: false,
      waitedMs: 0,
      pollAttempts: 1,
    };
  }

  const timeoutMs = options?.timeoutMs ?? loadTxPollTimeoutMs();
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_TX_POLL_INTERVAL_MS;
  const start = Date.now();
  let pollAttempts = 0;
  let lastMeta: unknown;

  while (Date.now() - start <= timeoutMs) {
    pollAttempts += 1;

    const primary = await pocket.rpc(chain, method, [hash]);
    lastMeta = primary.meta;
    if (primary.result != null) {
      return {
        result: primary.result,
        meta: primary.meta,
        polled: pollAttempts > 1,
        waitedMs: Date.now() - start,
        pollAttempts,
        pending:
          method === "eth_getTransactionReceipt"
            ? false
            : isPendingTransaction(primary.result) || undefined,
      };
    }

    const txResp = await pocket.rpc(chain, "eth_getTransactionByHash", [hash]);
    lastMeta = txResp.meta;
    if (txResp.result != null) {
      if (method === "eth_getTransactionByHash") {
        return {
          result: txResp.result,
          meta: txResp.meta,
          polled: pollAttempts > 1,
          waitedMs: Date.now() - start,
          pollAttempts,
          pending: isPendingTransaction(txResp.result) || undefined,
        };
      }
      if (isPendingTransaction(txResp.result)) {
        if (Date.now() - start + pollIntervalMs > timeoutMs) break;
        await sleep(pollIntervalMs);
        continue;
      }
    }

    if (Date.now() - start + pollIntervalMs > timeoutMs) break;
    await sleep(pollIntervalMs);
  }

  return {
    result: null,
    meta: lastMeta,
    polled: pollAttempts > 1,
    waitedMs: Date.now() - start,
    pollAttempts,
  };
}

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
  waitedMs?: number;
  pollAttempts?: number;
}

export function buildTxNotFoundInfo(
  chain: string,
  hash: string,
  method: string,
  opts?: { waitedMs?: number; pollAttempts?: number },
): TxNotFoundInfo {
  const chainInfo = resolveChain(chain);
  const chainName = chainInfo?.name ?? chain;
  const explorerBase = chainInfo?.blockExplorer?.replace(/\/$/, "");
  const explorerUrl = explorerBase ? `${explorerBase}/tx/${hash}` : undefined;
  const lookupKind = method === "eth_getTransactionReceipt" ? "receipt" : "transaction";
  const waitedSec =
    opts?.waitedMs && opts.waitedMs >= 1000 ? Math.round(opts.waitedMs / 1000) : undefined;

  const message = waitedSec
    ? `No ${lookupKind} found for ${hash} on ${chainName} after waiting ~${waitedSec}s. ` +
      "The transaction may still be propagating, may be on a different network, or the hash may be incorrect."
    : `No ${lookupKind} found for ${hash} on ${chainName}. ` +
      "The RPC returned null — this usually means the transaction does not exist on this chain, " +
      "has not been mined yet, or the hash may be incorrect.";

  const suggestions = [
    "Double-check the transaction hash for typos.",
    `Confirm the transaction was sent on ${chainName}, not another network.`,
  ];
  if (waitedSec) {
    suggestions.push("If you just submitted this transaction, wait a bit longer and try again.");
  } else {
    suggestions.push("If the transaction was just submitted, wait for confirmation and try again.");
  }
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
    waitedMs: opts?.waitedMs,
    pollAttempts: opts?.pollAttempts,
  };
}

export function enrichTxLookupOutput(
  method: string,
  chain: string,
  params: unknown[],
  output: {
    result?: unknown;
    meta?: unknown;
    polled?: boolean;
    waitedMs?: number;
    pollAttempts?: number;
    pending?: boolean;
  },
): Record<string, unknown> {
  if (!isTxLookupMethod(method)) {
    return output as Record<string, unknown>;
  }

  const hash = extractTxHashFromParams(params);
  if (!hash) return output as Record<string, unknown>;

  if (output.result != null) {
    const enriched: Record<string, unknown> = { ...output };
    if (output.pending) {
      enriched.pending = true;
      enriched.message = `Transaction ${hash} is in the mempool on ${resolveChain(chain)?.name ?? chain} (pending confirmation).`;
    } else if (output.polled && output.waitedMs) {
      const waitedSec = Math.max(1, Math.round(output.waitedMs / 1000));
      enriched.message = `Transaction found after waiting ~${waitedSec}s.`;
    }
    return enriched;
  }

  const notFound = buildTxNotFoundInfo(chain, hash, method, {
    waitedMs: output.waitedMs,
    pollAttempts: output.pollAttempts,
  });
  return {
    ...output,
    result: null,
    notFound,
    message: notFound.message,
  };
}

export function formatTxPendingMessage(hash: string, chain: string): string {
  const chainName = resolveChain(chain)?.name ?? chain;
  return [
    `Transaction ${hash} is pending on ${chainName}.`,
    "It has been seen in the mempool but is not confirmed yet.",
    "Try again in a few seconds for receipt and block details.",
  ].join("\n");
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
