import { resolveChain } from "@pokt-mcp/pocket-client";
import type { ChatHistoryMessage, LastTransferQuery, RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { extractAddress, inferChain, intent, normalizeQuery } from "./patterns.js";
import { extractErc20TokenSymbol } from "./erc20-balance.js";
import { isTransferDisputeFollowUp } from "./pattern-lib/follow-up-phrases.js";
import {
  explorerAccountAction,
  loadExplorerApiKey,
  type ExplorerTokenTxRow,
} from "./explorer-api.js";
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
  source?: "rpc" | "explorer";
  note?: string;
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

const EMPTY_TRANSFER_ASSISTANT =
  /No\s+(USDC|USDT|DAI|WETH|WBTC|LINK|UNI|AAVE)\s+Transfer events for\s+(0x[a-fA-F0-9]{40})/i;
const RECENT_TRANSFER_ASSISTANT =
  /\brecent\s+(USDC|USDT|DAI|WETH|WBTC|LINK|UNI|AAVE)\s+Transfer event/i;

function inferChainFromTransferTurn(
  userContent: string,
  assistantContent: string,
  context?: SessionContext,
): string {
  const fromUser = inferChain(userContent, context);
  if (fromUser) return fromUser;
  const onChain = assistantContent.match(/\bon\s+([A-Za-z][\w\s-]+?)(?:\s+in|\s*$|[.:])/);
  if (onChain) {
    const resolved = resolveChain(onChain[1].trim());
    if (resolved) return resolved.slug;
  }
  return context?.defaultChain ?? "eth";
}

export function inferTransferContextFromHistory(
  history: ChatHistoryMessage[],
  context?: SessionContext,
): LastTransferQuery | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant") {
      const emptyMatch = msg.content.match(EMPTY_TRANSFER_ASSISTANT);
      if (emptyMatch) {
        const priorUser = history.slice(0, i).reverse().find((m) => m.role === "user")?.content ?? "";
        return {
          chain: inferChainFromTransferTurn(priorUser, msg.content, context),
          tokenSymbol: emptyMatch[1].toUpperCase(),
          walletAddress: emptyMatch[2],
          blockRange: extractBlockRange(priorUser),
          hadEmptyResult: true,
        };
      }

      const eventsMatch = msg.content.match(RECENT_TRANSFER_ASSISTANT);
      if (eventsMatch) {
        const priorUser = history.slice(0, i).reverse().find((m) => m.role === "user")?.content ?? "";
        const wallet = extractAddress(priorUser) ?? extractAddress(msg.content);
        if (!wallet) continue;
        return {
          chain: inferChainFromTransferTurn(priorUser, msg.content, context),
          tokenSymbol: eventsMatch[1].toUpperCase(),
          walletAddress: wallet,
          blockRange: extractBlockRange(priorUser),
          hadEmptyResult: false,
        };
      }
    }

    if (msg.role === "user") {
      const transferIntent = matchTransferEventQuery(msg.content, context);
      if (transferIntent) {
        const [chain, symbol, walletAddress, blockRange] = transferIntent.params as [
          string,
          string,
          string,
          number,
        ];
        return {
          chain,
          tokenSymbol: symbol,
          walletAddress,
          blockRange,
          hadEmptyResult: false,
        };
      }

      const symbol = extractErc20TokenSymbol(msg.content);
      const wallet = extractAddress(msg.content);
      if (symbol && wallet && /\btransfer/i.test(msg.content)) {
        const chain = inferChain(msg.content, context);
        if (KNOWN_TOKENS[chain]?.[symbol]) {
          return {
            chain,
            tokenSymbol: symbol,
            walletAddress: wallet,
            blockRange: extractBlockRange(msg.content),
            hadEmptyResult: false,
          };
        }
      }
    }
  }
  return null;
}

function resolveTransferFollowUpContext(
  context?: SessionContext,
  history?: ChatHistoryMessage[],
): LastTransferQuery | null {
  if (context?.lastTransferQuery) return context.lastTransferQuery;
  if (history?.length) {
    const inferred = inferTransferContextFromHistory(history, context);
    if (inferred) return inferred;
  }
  return null;
}

export function matchTransferEventFollowUp(
  query: string,
  context?: SessionContext,
  history?: ChatHistoryMessage[],
): RpcIntent | null {
  const dispute = isTransferDisputeFollowUp(query);
  const wantsBalance = /\b(?:balance|holdings|holding|have)\b/i.test(query);
  const last = resolveTransferFollowUpContext(context, history);

  if (!last) {
    if (!dispute && !wantsBalance) return null;

    if (context?.connectedAddress) {
      const chain = inferChain(query, context);
      return intent(
        chain,
        "__wallet_balances__",
        [chain, context.connectedAddress],
        `Check connected wallet token balances on ${chain}`,
      );
    }

    if (dispute || wantsBalance) {
      throw new Error(
        "TRANSFER_CONTEXT_REQUIRED: Specify which token and wallet — e.g. \"Recent USDC Transfer events for 0x… on eth\" — or connect your wallet and ask again.",
      );
    }
    return null;
  }

  if (wantsBalance && (dispute || last.hadEmptyResult)) {
    return intent(
      last.chain,
      "__erc20_balance__",
      [last.chain, last.tokenSymbol, last.walletAddress],
      `Get ${last.tokenSymbol} balance for ${last.walletAddress} on ${last.chain}`,
    );
  }

  if (!dispute) return null;

  if (
    !loadExplorerApiKey() &&
    !/\b(?:look|search|further|history|transfers?|events?|logs?)\b/i.test(query)
  ) {
    return intent(
      last.chain,
      "__erc20_balance__",
      [last.chain, last.tokenSymbol, last.walletAddress],
      `Get ${last.tokenSymbol} balance for ${last.walletAddress} on ${last.chain}`,
    );
  }

  return intent(
    last.chain,
    "__transfer_events__",
    [last.chain, last.tokenSymbol, last.walletAddress, last.blockRange, true],
    `Get full ${last.tokenSymbol} transfer history for ${last.walletAddress} on ${last.chain}`,
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

async function fetchTransferEventsFromExplorer(
  chain: string,
  symbol: string,
  walletAddress: string,
  tokenAddress: string,
  decimals: number,
  limit = 25,
): Promise<TransferEventEntry[]> {
  const apiKey = loadExplorerApiKey();
  if (!apiKey) return [];

  const rows = await explorerAccountAction<ExplorerTokenTxRow>(chain, "tokentx", walletAddress, apiKey, 100);
  const tokenLower = tokenAddress.toLowerCase();
  const wallet = walletAddress.toLowerCase();

  const events: TransferEventEntry[] = [];
  for (const tx of rows) {
    const contract = tx.contractAddress?.toLowerCase();
    const sym = tx.tokenSymbol?.toUpperCase();
    if (contract && contract !== tokenLower && sym !== symbol) continue;
    if (!contract && sym !== symbol) continue;

    const from = tx.from;
    const to = tx.to ?? "";
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    if (fromLower !== wallet && toLower !== wallet) continue;

    const direction = fromLower === wallet ? "out" : "in";
    const amountRaw = BigInt(tx.value || "0");
    events.push({
      direction,
      from,
      to,
      amount: formatTokenAmount(amountRaw, decimals),
      amountRaw: amountRaw.toString(),
      blockNumber: tx.blockNumber.startsWith("0x")
        ? tx.blockNumber
        : `0x${BigInt(tx.blockNumber).toString(16)}`,
      transactionHash: tx.hash,
      logIndex: "0x0",
    });
    if (events.length >= limit) break;
  }

  return dedupeEvents(events);
}

export async function executeTransferEvents(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  symbol: string,
  walletAddress: string,
  blockRange: number,
  preferExplorer = false,
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

  if (preferExplorer) {
    const explorerEvents = await fetchTransferEventsFromExplorer(
      chain,
      symbol,
      walletAddress,
      tokenInfo.address,
      tokenInfo.decimals,
    );
    if (explorerEvents.length > 0) {
      return {
        chain,
        tokenSymbol: symbol,
        tokenAddress: tokenInfo.address,
        walletAddress,
        fromBlock: "0x0",
        toBlock: latestResp.result,
        blockRange: Number(range),
        events: explorerEvents,
        source: "explorer",
      };
    }
  }

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
  let events = dedupeEvents(
    rawLogs
      .map((log) => decodeTransferLog(log, walletAddress, tokenInfo.decimals))
      .filter((entry): entry is TransferEventEntry => entry != null),
  );

  let source: "rpc" | "explorer" = "rpc";
  let note: string | undefined;

  if (events.length === 0 && loadExplorerApiKey()) {
    const explorerEvents = await fetchTransferEventsFromExplorer(
      chain,
      symbol,
      walletAddress,
      tokenInfo.address,
      tokenInfo.decimals,
    );
    if (explorerEvents.length > 0) {
      events = explorerEvents;
      source = "explorer";
    } else {
      note =
        "No matching transfers in recent blocks or indexed explorer history. The wallet may hold tokens from an older transfer, airdrop, or mint.";
    }
  } else if (events.length === 0) {
    note =
      "Scanned recent blocks only — set EXPLORER_API_KEY for full token transfer history.";
  }

  return {
    chain,
    tokenSymbol: symbol,
    tokenAddress: tokenInfo.address,
    walletAddress,
    fromBlock: fromBlockHex,
    toBlock: latestResp.result,
    blockRange: Number(range),
    events,
    source,
    note,
  };
}

export function formatTransferEvents(result: TransferEventsResult): string {
  const chainInfo = resolveChain(result.chain);
  const chainName = chainInfo?.name ?? result.chain;
  const wallet = shortAddress(result.walletAddress);

  if (result.events.length === 0) {
    const scope =
      result.source === "explorer"
        ? "indexed explorer history"
        : `the last ${result.blockRange.toLocaleString()} blocks`;
    const suffix = result.note ? ` ${result.note}` : "";
    return `\nNo ${result.tokenSymbol} Transfer events for ${wallet} on ${chainName} in ${scope}.${suffix}`;
  }

  const scopeLabel =
    result.source === "explorer"
      ? "indexed explorer history"
      : `last ${result.blockRange.toLocaleString()} blocks`;

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

  return `\n${result.events.length} recent ${result.tokenSymbol} Transfer event(s) for ${wallet} on ${chainName} (${scopeLabel}):\n${lines.join("\n")}${more}`;
}
