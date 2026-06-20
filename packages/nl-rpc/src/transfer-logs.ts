import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { extractAddress, inferChain, intent, normalizeQuery } from "./patterns.js";
import { extractErc20TokenSymbol } from "./erc20-balance.js";
import { KNOWN_TOKENS } from "./tokens.js";

/** keccak256("Transfer(address,address,uint256)") */
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const DEFAULT_RECENT_BLOCKS = 2000;
const MAX_BLOCK_RANGE = 10_000;

type RawLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
};

export type TransferEventEntry = {
  direction: "in" | "out";
  from: string;
  to: string;
  amount: string;
  amountRaw: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

export type TransferEventsResult = {
  chain: string;
  tokenSymbol: string;
  tokenAddress: string;
  walletAddress: string;
  fromBlock: string;
  toBlock: string;
  blockRange: number;
  events: TransferEventEntry[];
};

export function wantsTransferEvents(query: string): boolean {
  const q = normalizeQuery(query);
  if (!extractAddress(query)) return false;

  const hasTransfer = /\b(transfer|transfers)\b/.test(q);
  const hasEvents = /\b(events?|logs?)\b/.test(q);
  const hasRecentActivity =
    /\brecent\b/.test(q) && (hasTransfer || hasEvents || /\bactivity\b/.test(q));

  return (
    (hasTransfer && hasEvents) ||
    hasRecentActivity ||
    /\b(transfer|transfers)\s+(for|to|from|involving)\b/.test(q)
  );
}

export function isTransferEventQuery(query: string): boolean {
  return matchTransferEventQuery(query) != null;
}

export function extractBlockRange(query: string): number {
  const q = normalizeQuery(query);
  const match = q.match(/\blast\s+(\d+)\s+blocks?\b/);
  if (match) {
    return Math.min(parseInt(match[1], 10), MAX_BLOCK_RANGE);
  }
  return DEFAULT_RECENT_BLOCKS;
}

export function matchTransferEventQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!wantsTransferEvents(query)) return null;

  const walletAddress = extractAddress(query);
  if (!walletAddress || walletAddress.endsWith(".eth")) return null;

  const symbol = extractErc20TokenSymbol(query);
  if (!symbol) return null;

  const chain = inferChain(query, context);
  if (!KNOWN_TOKENS[chain]?.[symbol]) return null;

  const blockRange = extractBlockRange(query);
  return intent(
    chain,
    "__transfer_events__",
    [chain, symbol, walletAddress, blockRange],
    `Get recent ${symbol} Transfer events for ${walletAddress} on ${chain}`,
  );
}

function padTopicAddress(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function decodeTransferLog(
  log: RawLog,
  walletAddress: string,
  decimals: number,
): TransferEventEntry | null {
  const topics = log.topics ?? [];
  if (topics.length < 3 || !log.data) return null;

  const from = `0x${topics[1]!.slice(-40)}`;
  const to = `0x${topics[2]!.slice(-40)}`;
  const wallet = walletAddress.toLowerCase();
  const direction =
    from.toLowerCase() === wallet ? "out" : to.toLowerCase() === wallet ? "in" : null;
  if (!direction) return null;

  const amountRaw = BigInt(log.data);
  return {
    direction,
    from,
    to,
    amount: formatTokenAmount(amountRaw, decimals),
    amountRaw: amountRaw.toString(),
    blockNumber: log.blockNumber ?? "0x0",
    transactionHash: log.transactionHash ?? "",
    logIndex: log.logIndex ?? "0x0",
  };
}

function dedupeEvents(events: TransferEventEntry[]): TransferEventEntry[] {
  const seen = new Set<string>();
  const out: TransferEventEntry[] = [];
  for (const event of events) {
    const key = `${event.transactionHash}:${event.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out.sort((a, b) => {
    const blockDiff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
    if (blockDiff !== 0n) return blockDiff > 0n ? 1 : -1;
    return Number(BigInt(b.logIndex) - BigInt(a.logIndex));
  });
}

export async function executeTransferEvents(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  symbol: string,
  walletAddress: string,
  blockRange: number,
): Promise<TransferEventsResult> {
  const tokenInfo = KNOWN_TOKENS[chain]?.[symbol];
  if (!tokenInfo) {
    throw new Error(`NL_PARSE_FAILED: unknown token ${symbol} on chain ${chain}`);
  }

  const latestResp = await pocket.rpc<string>(chain, "eth_blockNumber", []);
  const latestBlock = BigInt(latestResp.result);
  const range = BigInt(Math.max(1, Math.min(blockRange, MAX_BLOCK_RANGE)));
  const fromBlock = latestBlock > range ? latestBlock - range : 0n;
  const fromBlockHex = `0x${fromBlock.toString(16)}`;
  const walletTopic = padTopicAddress(walletAddress);

  const baseFilter = {
    address: tokenInfo.address,
    fromBlock: fromBlockHex,
    toBlock: "latest" as const,
  };

  const [outgoing, incoming] = await Promise.all([
    pocket.rpc<RawLog[]>(chain, "eth_getLogs", [
      { ...baseFilter, topics: [ERC20_TRANSFER_TOPIC, walletTopic, null] },
    ]),
    pocket.rpc<RawLog[]>(chain, "eth_getLogs", [
      { ...baseFilter, topics: [ERC20_TRANSFER_TOPIC, null, walletTopic] },
    ]),
  ]);

  const rawLogs = [...(outgoing.result ?? []), ...(incoming.result ?? [])];
  const events = dedupeEvents(
    rawLogs
      .map((log) => decodeTransferLog(log, walletAddress, tokenInfo.decimals))
      .filter((entry): entry is TransferEventEntry => entry != null),
  );

  return {
    chain,
    tokenSymbol: symbol,
    tokenAddress: tokenInfo.address,
    walletAddress,
    fromBlock: fromBlockHex,
    toBlock: latestResp.result,
    blockRange: Number(range),
    events,
  };
}

export function formatTransferEvents(result: TransferEventsResult): string {
  const chainInfo = resolveChain(result.chain);
  const chainName = chainInfo?.name ?? result.chain;
  const wallet = shortAddress(result.walletAddress);

  if (result.events.length === 0) {
    return `\nNo ${result.tokenSymbol} Transfer events for ${wallet} on ${chainName} in the last ${result.blockRange.toLocaleString()} blocks.`;
  }

  const lines = result.events.slice(0, 10).map((event) => {
    const arrow = event.direction === "in" ? "←" : "→";
    const peer = event.direction === "in" ? event.from : event.to;
    const block = BigInt(event.blockNumber).toString();
    return `- ${arrow} ${event.amount} ${result.tokenSymbol} ${event.direction === "in" ? "from" : "to"} ${shortAddress(peer)} (block ${block}, tx ${event.transactionHash.slice(0, 10)}…)`;
  });

  const more =
    result.events.length > 10
      ? `\n… and ${result.events.length - 10} more event(s).`
      : "";

  return `\n${result.events.length} recent ${result.tokenSymbol} Transfer event(s) for ${wallet} on ${chainName} (last ${result.blockRange.toLocaleString()} blocks):\n${lines.join("\n")}${more}`;
}
