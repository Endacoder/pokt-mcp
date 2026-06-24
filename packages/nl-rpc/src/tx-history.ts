import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import {
  directionFor,
  explorerAccountAction,
  fetchExplorerTxList,
  formatWeiToNative,
  loadExplorerApiKey,
  type ExplorerTokenTxRow,
  type ExplorerTxRow,
} from "./explorer-api.js";
import { extractAddress, inferChain, resolveAddress, wantsMyWallet } from "./patterns.js";

const TX_HISTORY_PATTERNS = [
  /\b(last|recent|latest)\s+(\d+)\s+transactions?\b/i,
  /\b(\d+)\s+(most recent|latest|last)\s+transactions?\b/i,
  /\b(last|recent|latest)\s+transactions?\b/i,
  /\btransaction history\b/i,
  /\b(recent|latest)\s+activity\b/i,
  /\bmy (account )?activity\b/i,
];

const PAYMENT_FROM_ME_PATTERNS = [
  /\bever\s+received\s+anything\s+from\s+me\b/i,
  /\breceived\s+anything\s+from\s+me\b/i,
  /\bhas\s+0x[a-fA-F0-9]{40}\s+ever\s+received\b/i,
  /\bdid\s+0x[a-fA-F0-9]{40}\s+receive\b.*\bfrom\s+me\b/i,
  /\bhave\s+i\s+ever\s+sent\s+anything\s+to\b/i,
  /\bsent\s+anything\s+to\s+0x[a-fA-F0-9]{40}\b/i,
  /\bfrom\s+me\b.*\b0x[a-fA-F0-9]{40}\b/i,
];

export type TxHistoryEntry = {
  hash: string;
  from: string;
  to: string;
  valueWei: string;
  valueNative: string;
  blockNumber: string;
  timestamp?: number;
  direction: "in" | "out" | "self";
  explorerUrl?: string;
};

export type TxHistoryResult = {
  chain: string;
  chainName: string;
  address: string;
  limit: number;
  transactions: TxHistoryEntry[];
  source: "explorer" | "block_scan";
  note?: string;
};

export type PaymentFromMeResult = {
  chain: string;
  chainName: string;
  fromAddress: string;
  toAddress: string;
  nativeTransfers: TxHistoryEntry[];
  tokenTransfers: Array<{
    hash: string;
    tokenSymbol: string;
    value: string;
    blockNumber: string;
    explorerUrl?: string;
  }>;
  everReceived: boolean;
};

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractLimit(query: string, defaultLimit = 5): number {
  const patterns = [
    /\b(last|recent|latest)\s+(\d+)\s+transactions?\b/i,
    /\b(\d+)\s+(most recent|latest|last)\s+transactions?\b/i,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    const n = match?.[2] ?? match?.[1];
    if (n && /^\d+$/.test(n)) {
      return Math.min(Math.max(parseInt(n, 10), 1), 25);
    }
  }
  return defaultLimit;
}

export function isTxHistoryQuery(query: string): boolean {
  const q = normalize(query);
  if (!TX_HISTORY_PATTERNS.some((p) => p.test(q))) return false;
  if (/\btransaction\s+(0x[a-fA-F0-9]{64})\b/.test(q)) return false;
  if (/\b(tx|transaction)\s+hash\b/.test(q)) return false;
  return true;
}

export function matchTxHistoryQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isTxHistoryQuery(query)) return null;

  const chain = inferChain(query, context);
  const address = resolveAddress(query, context);
  if (!address) {
    if (wantsMyWallet(query) || /\bmy account\b/i.test(query)) {
      throw new Error(
        "WALLET_NOT_CONNECTED: Connect your wallet to fetch your transaction history, or provide an explicit address.",
      );
    }
    return null;
  }

  const limit = extractLimit(query);
  return {
    action: "read",
    chain,
    method: "__tx_history__",
    params: [chain, address, limit],
    humanSummary: `Get last ${limit} transactions for ${address} on ${chain}`,
    riskLevel: "none",
  };
}

export function isPaymentFromMeQuery(query: string): boolean {
  const q = normalize(query);
  if (!PAYMENT_FROM_ME_PATTERNS.some((p) => p.test(q))) return false;
  if (!/\bfrom\s+me\b/i.test(q) && !/\bsent\s+anything\s+to\b/i.test(q) && !/\bhave\s+i\s+ever\s+sent\b/i.test(q)) {
    return false;
  }
  return Boolean(extractAddress(query));
}

export function matchPaymentFromMeQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isPaymentFromMeQuery(query)) return null;

  const chain = inferChain(query, context);
  const targetAddress = extractAddress(query);
  if (!targetAddress) return null;

  const fromAddress = context?.connectedAddress ?? context?.lastBalance?.address ?? null;
  if (!fromAddress) {
    throw new Error(
      "WALLET_NOT_CONNECTED: Connect your wallet to check whether an address received funds from you.",
    );
  }

  return {
    action: "read",
    chain,
    method: "__payment_from_me__",
    params: [chain, fromAddress, targetAddress],
    humanSummary: `Check if ${targetAddress} ever received transfers from ${fromAddress} on ${chain}`,
    riskLevel: "none",
  };
}

async function fetchFromExplorer(
  chain: string,
  address: string,
  limit: number,
  apiKey: string,
): Promise<TxHistoryEntry[]> {
  const chainInfo = resolveChain(chain);
  const symbol = chainInfo?.nativeSymbol ?? "ETH";
  const explorer = chainInfo?.blockExplorer?.replace(/\/$/, "");

  const rows = await fetchExplorerTxList(chain, address, limit, apiKey);

  return rows.slice(0, limit).map((tx) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to ?? "",
    valueWei: `0x${BigInt(tx.value).toString(16)}`,
    valueNative: formatWeiToNative(`0x${BigInt(tx.value).toString(16)}`, symbol),
    blockNumber: tx.blockNumber,
    timestamp: tx.timeStamp ? Number(tx.timeStamp) : undefined,
    direction: directionFor(address, tx.from, tx.to ?? ""),
    explorerUrl: explorer ? `${explorer}/tx/${tx.hash}` : undefined,
  }));
}

/** Recent txs via Pocket RPC block scan (no explorer index). Limited to recent blocks. */
export async function fetchRecentTxsViaBlockScan(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
  limit: number,
  maxBlocks = 150,
  maxTxHashesPerBlock = 80,
): Promise<TxHistoryEntry[]> {
  const normalized = address.toLowerCase();
  const chainInfo = resolveChain(chain);
  const symbol = chainInfo?.nativeSymbol ?? "ETH";
  const explorer = chainInfo?.blockExplorer?.replace(/\/$/, "");

  const headResp = await pocket.rpc<string>(chain, "eth_blockNumber", []);
  let blockNum = BigInt(headResp.result);
  const found: TxHistoryEntry[] = [];

  for (let i = 0; i < maxBlocks && found.length < limit; i++) {
    const tag = `0x${(blockNum - BigInt(i)).toString(16)}`;
    const blockResp = await pocket.rpc(chain, "eth_getBlockByNumber", [tag, false]);
    const block = blockResp.result as {
      number?: string;
      transactions?: string[];
    } | null;
    const txHashes = block?.transactions ?? [];
    if (txHashes.length === 0) continue;

    for (const hash of txHashes.slice(0, maxTxHashesPerBlock)) {
      if (found.length >= limit) break;
      const txResp = await pocket.rpc(chain, "eth_getTransactionByHash", [hash]);
      const tx = txResp.result as {
        hash?: string;
        from?: string;
        to?: string;
        value?: string;
      } | null;
      if (!tx?.hash || !tx.from) continue;

      const from = tx.from.toLowerCase();
      const to = tx.to?.toLowerCase() ?? "";
      if (from !== normalized && to !== normalized) continue;

      found.push({
        hash: tx.hash,
        from: tx.from,
        to: tx.to ?? "",
        valueWei: tx.value ?? "0x0",
        valueNative: formatWeiToNative(tx.value ?? "0x0", symbol),
        blockNumber: block?.number ?? tag,
        direction: directionFor(address, tx.from, tx.to ?? ""),
        explorerUrl: explorer ? `${explorer}/tx/${tx.hash}` : undefined,
      });
    }
  }

  return found;
}

export async function fetchPaymentFromMe(
  _pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  fromAddress: string,
  toAddress: string,
): Promise<PaymentFromMeResult> {
  const chainInfo = resolveChain(chain);
  if (!chainInfo || chainInfo.protocol !== "evm") {
    throw new Error(`Payment lookup is only supported on EVM chains (got ${chain})`);
  }

  const apiKey = loadExplorerApiKey();
  if (!apiKey) {
    throw new Error(
      "EXPLORER_API_KEY required: set EXPLORER_API_KEY (Etherscan API V2) to check whether an address received funds from your wallet.",
    );
  }

  const from = fromAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  const symbol = chainInfo.nativeSymbol ?? "ETH";
  const explorer = chainInfo.blockExplorer?.replace(/\/$/, "");

  const [nativeRows, tokenRows] = await Promise.all([
    explorerAccountAction<ExplorerTxRow>(chain, "txlist", fromAddress, apiKey),
    explorerAccountAction<ExplorerTokenTxRow>(chain, "tokentx", fromAddress, apiKey),
  ]);

  const nativeTransfers = nativeRows
    .filter((tx) => tx.from.toLowerCase() === from && tx.to?.toLowerCase() === to && BigInt(tx.value || "0") > 0n)
    .map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to ?? "",
      valueWei: `0x${BigInt(tx.value).toString(16)}`,
      valueNative: formatWeiToNative(`0x${BigInt(tx.value).toString(16)}`, symbol),
      blockNumber: tx.blockNumber,
      timestamp: tx.timeStamp ? Number(tx.timeStamp) : undefined,
      direction: "out" as const,
      explorerUrl: explorer ? `${explorer}/tx/${tx.hash}` : undefined,
    }));

  const tokenTransfers = tokenRows
    .filter((tx) => tx.from.toLowerCase() === from && tx.to?.toLowerCase() === to)
    .map((tx) => ({
      hash: tx.hash,
      tokenSymbol: tx.tokenSymbol ?? "TOKEN",
      value: tx.value,
      blockNumber: tx.blockNumber,
      explorerUrl: explorer ? `${explorer}/tx/${tx.hash}` : undefined,
    }));

  return {
    chain,
    chainName: chainInfo.name,
    fromAddress,
    toAddress,
    nativeTransfers,
    tokenTransfers,
    everReceived: nativeTransfers.length > 0 || tokenTransfers.length > 0,
  };
}

export function formatPaymentFromMe(result: PaymentFromMeResult): string {
  const toShort = `${result.toAddress.slice(0, 6)}…${result.toAddress.slice(-4)}`;
  const fromShort = `${result.fromAddress.slice(0, 6)}…${result.fromAddress.slice(-4)}`;

  if (!result.everReceived) {
    return `\nNo — ${toShort} has not received any native or ERC-20 transfers from your wallet (${fromShort}) on ${result.chainName}, based on Etherscan history.`;
  }

  const lines = [`Yes — ${toShort} has received transfers from your wallet (${fromShort}) on ${result.chainName}:`];
  for (const tx of result.nativeTransfers.slice(0, 5)) {
    lines.push(`· ${tx.valueNative} native · block ${BigInt(tx.blockNumber).toString()} · ${tx.hash.slice(0, 10)}…`);
  }
  for (const tx of result.tokenTransfers.slice(0, 5)) {
    lines.push(`· ${tx.tokenSymbol} transfer · block ${BigInt(tx.blockNumber).toString()} · ${tx.hash.slice(0, 10)}…`);
  }
  const total = result.nativeTransfers.length + result.tokenTransfers.length;
  if (total > 10) {
    lines.push(`…and ${total - 10} more matching transfers.`);
  }
  return `\n${lines.join("\n")}`;
}

export async function fetchTxHistory(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
  limit: number,
): Promise<TxHistoryResult> {
  const chainInfo = resolveChain(chain);
  if (!chainInfo || chainInfo.protocol !== "evm") {
    throw new Error(`Transaction history is only supported on EVM chains (got ${chain})`);
  }

  const apiKey = loadExplorerApiKey();
  if (apiKey && chainInfo.chainId) {
    const transactions = await fetchFromExplorer(chain, address, limit, apiKey);
    return {
      chain,
      chainName: chainInfo.name,
      address,
      limit,
      transactions,
      source: "explorer",
    };
  }

  if (!apiKey) {
    throw new Error(
      "EXPLORER_API_KEY required: set EXPLORER_API_KEY (Etherscan API V2) to fetch wallet transaction history. Standard chain RPC has no get-transactions-by-address method.",
    );
  }

  const transactions = await fetchRecentTxsViaBlockScan(pocket, chain, address, limit, 30);
  return {
    chain,
    chainName: chainInfo.name,
    address,
    limit,
    transactions,
    source: "block_scan",
    note:
      transactions.length < limit
        ? "Scanned recent blocks only — set EXPLORER_API_KEY for complete history."
        : "Recent blocks scan — set EXPLORER_API_KEY for complete history.",
  };
}

export function formatTxHistory(result: TxHistoryResult): string {
  const short = `${result.address.slice(0, 6)}…${result.address.slice(-4)}`;
  if (result.transactions.length === 0) {
    return `\nNo recent transactions found for ${short} on ${result.chainName}.${result.note ? ` ${result.note}` : ""}`;
  }

  const lines = [
    `Last ${result.transactions.length} transactions for ${short} on ${result.chainName}:`,
  ];
  for (const [i, tx] of result.transactions.entries()) {
    const dir =
      tx.direction === "in" ? "in" : tx.direction === "out" ? "out" : "self";
    lines.push(
      `${i + 1}. ${dir} · ${tx.valueNative} · block ${BigInt(tx.blockNumber).toString()} · ${tx.hash.slice(0, 10)}…`,
    );
  }
  if (result.note) lines.push(result.note);
  return `\n${lines.join("\n")}`;
}
