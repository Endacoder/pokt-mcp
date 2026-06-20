import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { inferChain, intent, resolveAddress, wantsBalance, wantsGasPrice, wantsLatestBlock } from "./patterns.js";

export type TemporalSubject = "gas" | "balance" | "blockNumber";

const TIME_OFFSET =
  /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo)\s+ago\b/i;

const TEMPORAL_FOLLOW_UP =
  /\b(what\s+was\s+it|what\s+about\s+it|how\s+about\s+(?:then|it)|and\s+(?:then|what\s+about))\b/i;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  w: 604800,
  week: 604800,
  weeks: 604800,
  mo: 2592000,
  month: 2592000,
  months: 2592000,
};

export function parseTimeOffsetSeconds(query: string): number | null {
  const q = query.toLowerCase();
  if (/\byesterday\b/.test(q)) return 86_400;
  if (/\blast\s+hour\b/.test(q)) return 3_600;
  if (/\blast\s+day\b/.test(q)) return 86_400;
  if (/\blast\s+week\b/.test(q)) return 604_800;
  if (/\ban?\s+hour\s+ago\b/.test(q)) return 3_600;
  if (/\ban?\s+day\s+ago\b/.test(q)) return 86_400;

  const match = q.match(TIME_OFFSET);
  if (!match) return null;

  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unitKey = match[2].toLowerCase().replace(/s$/, "");
  const seconds = UNIT_SECONDS[unitKey] ?? UNIT_SECONDS[`${unitKey}s`];
  if (!seconds) return null;

  return Math.round(amount * seconds);
}

export function formatTimeOffsetLabel(seconds: number): string {
  if (seconds % 86_400 === 0 && seconds >= 86_400) {
    const days = seconds / 86_400;
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (seconds % 3_600 === 0 && seconds >= 3_600) {
    const hours = seconds / 3_600;
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return seconds === 1 ? "1 second ago" : `${seconds} seconds ago`;
}

function isTemporalFollowUp(query: string): boolean {
  return TEMPORAL_FOLLOW_UP.test(query);
}

function resolveSubject(
  query: string,
  context?: SessionContext,
): { subject: TemporalSubject; chain: string; params: unknown[] } | null {
  const followUp = isTemporalFollowUp(query);
  const last = context?.lastQuery;

  if (wantsGasPrice(query) || /\bgas\b/i.test(query)) {
    return {
      subject: "gas",
      chain: inferChain(query, context),
      params: [],
    };
  }

  if (wantsLatestBlock(query) || /\b(block\s+number|latest\s+block)\b/i.test(query)) {
    return {
      subject: "blockNumber",
      chain: inferChain(query, context),
      params: [],
    };
  }

  const address = resolveAddress(query, context);
  if (wantsBalance(query) && address) {
    return {
      subject: "balance",
      chain: inferChain(query, context),
      params: [address],
    };
  }

  if (followUp && last) {
    return {
      subject: last.subject,
      chain: last.chain,
      params: last.params ?? [],
    };
  }

  if (last && !followUp) {
    if (last.subject === "gas" && /\b(price|fee|cost)\b/i.test(query)) {
      return { subject: "gas", chain: inferChain(query, context) || last.chain, params: [] };
    }
    if (last.subject === "balance" && /\b(balance|worth|holdings)\b/i.test(query)) {
      const addr = address ?? (last.params?.[0] as string | undefined);
      if (addr) return { subject: "balance", chain: last.chain, params: [addr] };
    }
  }

  return null;
}

export function matchTemporalQuery(
  query: string,
  chain: string,
  context?: SessionContext,
): RpcIntent | null {
  const offsetSeconds = parseTimeOffsetSeconds(query);
  if (offsetSeconds === null) return null;

  const resolved = resolveSubject(query, context);
  if (!resolved) return null;

  const subjectChain = resolved.chain || chain;
  const label = formatTimeOffsetLabel(offsetSeconds);

  let summary: string;
  switch (resolved.subject) {
    case "gas":
      summary = `Get gas price on ${subjectChain} from ${label}`;
      break;
    case "balance":
      summary = `Get balance for ${resolved.params[0]} on ${subjectChain} from ${label}`;
      break;
    case "blockNumber":
      summary = `Get block number on ${subjectChain} from ${label}`;
      break;
  }

  return intent(
    subjectChain,
    "__query_at_time__",
    [subjectChain, resolved.subject, offsetSeconds, ...resolved.params],
    summary,
  );
}

type EthBlockHeader = {
  number?: string;
  timestamp?: string;
  baseFeePerGas?: string;
  gasPrice?: string;
};

type FeeHistoryResult = {
  oldestBlock: string;
  baseFeePerGas: string[];
};

/** Typical block time in seconds for narrowing historical block search. */
const CHAIN_BLOCK_TIME_SEC: Record<string, number> = {
  eth: 12,
  base: 2,
  "arb-one": 0.25,
  opt: 2,
  poly: 2,
  bsc: 3,
  avax: 2,
  gnosis: 5,
  fantom: 1,
  scroll: 3,
  blast: 2,
  linea: 2,
  zksync: 1,
  fraxtal: 2,
  celo: 5,
  mantle: 2,
  moonbeam: 12,
  kava: 6,
  metis: 2,
  bera: 2,
  solana: 0.4,
};

const MAX_FEE_HISTORY_BLOCKS = 1024;

function getBlockTimeSec(chain: string): number {
  return CHAIN_BLOCK_TIME_SEC[chain] ?? 12;
}

/** Narrow binary-search window from estimated block height (avoids scanning full chain). */
export function estimateBlockSearchWindow(
  latestBlock: bigint,
  latestTs: number,
  targetTimestampSec: number,
  blockTimeSec: number,
): { lo: bigint; hi: bigint } {
  const deltaSec = latestTs - targetTimestampSec;
  if (deltaSec <= 0) {
    return { lo: latestBlock, hi: latestBlock };
  }

  const blocksBack = BigInt(Math.ceil(deltaSec / blockTimeSec));
  const estimate = latestBlock > blocksBack ? latestBlock - blocksBack : 0n;
  const margin = BigInt(Math.max(32, Math.ceil(Number(blocksBack) * 0.05)));
  const lo = estimate > margin ? estimate - margin : 0n;
  const hi = estimate + margin > latestBlock ? latestBlock : estimate + margin;
  return { lo, hi };
}

export async function findBlockAtTimestamp(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  targetTimestampSec: number,
): Promise<{ blockNumber: bigint; timestamp: number; header: EthBlockHeader }> {
  const latestResp = await pocket.rpc(chain, "eth_blockNumber", []);
  const latestBlock = BigInt(latestResp.result as string);

  const latestHeader = await getBlockHeader(pocket, chain, latestBlock);
  const latestTs = hexToNumber(latestHeader.timestamp);
  if (targetTimestampSec >= latestTs) {
    return { blockNumber: latestBlock, timestamp: latestTs, header: latestHeader };
  }

  const blockTime = getBlockTimeSec(chain);
  const { lo, hi } = estimateBlockSearchWindow(latestBlock, latestTs, targetTimestampSec, blockTime);

  let searchLo = lo;
  let searchHi = hi;
  while (searchLo < searchHi) {
    const mid = (searchLo + searchHi) >> 1n;
    const block = await getBlockHeader(pocket, chain, mid);
    const ts = hexToNumber(block.timestamp);
    if (ts < targetTimestampSec) {
      searchLo = mid + 1n;
    } else {
      searchHi = mid;
    }
  }

  const header = await getBlockHeader(pocket, chain, searchLo);
  return { blockNumber: searchLo, timestamp: hexToNumber(header.timestamp), header };
}

async function gasAtOffsetViaFeeHistory(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  offsetSeconds: number,
): Promise<{ blockNumber: bigint; timestamp: number; header: EthBlockHeader; gasHex: string }> {
  const blockTime = getBlockTimeSec(chain);
  const blockCount = Math.min(MAX_FEE_HISTORY_BLOCKS, Math.max(1, Math.ceil(offsetSeconds / blockTime)));

  const resp = await pocket.rpc(chain, "eth_feeHistory", [blockCount, "latest", [25]]);
  const history = (resp.result ?? {}) as FeeHistoryResult;
  const gasHex = history.baseFeePerGas?.[0];
  const oldestBlock = BigInt(history.oldestBlock ?? "0x0");

  if (!gasHex) {
    throw new Error(`No fee history returned for ${chain}`);
  }

  const blockTag = `0x${oldestBlock.toString(16)}`;
  return {
    blockNumber: oldestBlock,
    timestamp: Math.floor(Date.now() / 1000) - offsetSeconds,
    header: { number: blockTag, baseFeePerGas: gasHex },
    gasHex,
  };
}

async function getBlockHeader(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  blockNumber: bigint,
): Promise<EthBlockHeader> {
  const tag = `0x${blockNumber.toString(16)}`;
  const resp = await pocket.rpc(chain, "eth_getBlockByNumber", [tag, false]);
  return (resp.result ?? {}) as EthBlockHeader;
}

function hexToNumber(hex: string | undefined): number {
  if (!hex) return 0;
  return Number(BigInt(hex));
}

export type QueryAtTimeResult = {
  subject: TemporalSubject;
  chain: string;
  offsetSeconds: number;
  offsetLabel: string;
  blockNumber: string;
  blockTimestamp: number;
  blockTimeIso: string;
  result: string;
  gasGwei?: number;
  balanceNative?: string;
  address?: string;
};

export async function queryAtTime(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  subject: TemporalSubject,
  offsetSeconds: number,
  extraParams: unknown[] = [],
): Promise<QueryAtTimeResult> {
  const targetTs = Math.floor(Date.now() / 1000) - offsetSeconds;
  const offsetLabel = formatTimeOffsetLabel(offsetSeconds);

  let blockNumber: bigint;
  let timestamp: number;
  let header: EthBlockHeader;
  let gasHex: string | undefined;

  if (subject === "gas") {
    const blockTime = getBlockTimeSec(chain);
    const blockCount = Math.ceil(offsetSeconds / blockTime);
    if (blockCount <= MAX_FEE_HISTORY_BLOCKS) {
      const gasResult = await gasAtOffsetViaFeeHistory(pocket, chain, offsetSeconds);
      blockNumber = gasResult.blockNumber;
      timestamp = gasResult.timestamp;
      header = gasResult.header;
      gasHex = gasResult.gasHex;
    } else {
      const found = await findBlockAtTimestamp(pocket, chain, targetTs);
      blockNumber = found.blockNumber;
      timestamp = found.timestamp;
      header = found.header;
      gasHex = header.baseFeePerGas ?? header.gasPrice ?? "0x0";
    }
  } else {
    const found = await findBlockAtTimestamp(pocket, chain, targetTs);
    blockNumber = found.blockNumber;
    timestamp = found.timestamp;
    header = found.header;
  }

  const blockTag = `0x${blockNumber.toString(16)}`;

  const base: QueryAtTimeResult = {
    subject,
    chain,
    offsetSeconds,
    offsetLabel,
    blockNumber: blockTag,
    blockTimestamp: timestamp,
    blockTimeIso: new Date(timestamp * 1000).toISOString(),
    result: blockTag,
  };

  if (subject === "blockNumber") {
    return base;
  }

  if (subject === "gas") {
    const gasGwei = Number(BigInt(gasHex ?? "0x0")) / 1e9;
    return { ...base, result: gasHex ?? "0x0", gasGwei };
  }

  const address = extraParams[0];
  if (typeof address !== "string") {
    throw new Error("Historical balance query requires an address");
  }
  const balResp = await pocket.rpc(chain, "eth_getBalance", [address, blockTag]);
  const wei = balResp.result as string;
  const balanceNative = (Number(BigInt(wei)) / 1e18).toFixed(6).replace(/\.?0+$/, "") || "0";
  return { ...base, result: wei, balanceNative, address };
}
