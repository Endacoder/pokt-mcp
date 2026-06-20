import {
  createNlRpcEngine,
  executeIntent,
  formatErc20Balance,
  formatConvertedAmount,
  formatGasAssessmentMessage,
  formatInterpretationFallback,
  formatPriceChange24h,
  formatSpotPrice,
  formatMultiWalletBalances,
  formatWalletBalances,
  formatTxHistory,
  formatPaymentFromMe,
  formatCompareGas,
  formatPortfolioConversion,
  formatTransferEvents,
  formatTxNotFoundMessage,
  formatMarketAnalyticsUnsupported,
  gweiFromHex,
  interpretQueryResult,
  nativeBalanceToWeiHex,
  snapshotFromMultiWalletBalances,
  snapshotFromWalletBalances,
  needsResultInterpretation,
  wantsGasAssessment,
  assessGasPrice,
  buildInterpretationFacts,
  type WalletBalancesResult,
  type MultiWalletBalancesResult,
} from "@pokt-mcp/nl-rpc";
import { createPocketClient, type PocketClient } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { isAgentLoopEnabled, loadIntentMcpConfig, loadLlmConfig } from "@pokt-mcp/shared";
import { runIntentSwapRoute } from "./intent-swap.js";
import { runAgentLoop } from "./agent-loop.js";
import {
  isExecutionFailedError,
  isParseFailedError,
  isSwapQuery,
} from "./complexity.js";
import { isSwapStatusQuery, runIntentSwapStatusRoute } from "./intent-swap-status.js";
import { isSendStatusQuery, runSendStatusRoute } from "./send-status.js";
import type { AgentEvent } from "./types.js";

export type QueryRoute = "intent" | "agent" | "intent-swap" | "intent-swap-status" | "send-status";

export interface RouteQueryInput {
  query: string;
  sessionContext: SessionContext;
  pocket?: PocketClient;
  onSessionUpdate?: (patch: Partial<SessionContext>) => void;
}

function querySubject(method: string): "gas" | "balance" | "blockNumber" | null {
  if (method === "eth_gasPrice") return "gas";
  if (method === "eth_getBalance") return "balance";
  if (method === "eth_blockNumber") return "blockNumber";
  return null;
}

function rememberFromIntent(
  intent: RpcIntent,
  output: unknown,
  onSessionUpdate?: (patch: Partial<SessionContext>) => void,
): void {
  if (!onSessionUpdate) return;

  if (intent.method === "eth_getBalance") {
    const result = (output as { result?: unknown }).result;
    const address = intent.params[0];
    if (typeof result === "string" && typeof address === "string") {
      onSessionUpdate({
        lastBalance: { chain: intent.chain, address, wei: result },
      });
    }
  }

  if (intent.method === "__wallet_balances_multi__") {
    const multi = output as MultiWalletBalancesResult;
    if (multi.address) {
      onSessionUpdate({
        connectedAddress: multi.address,
        lastWalletPortfolio: snapshotFromMultiWalletBalances(multi),
      });
    }
  }

  if (intent.method === "__wallet_balances__") {
    const bal = output as WalletBalancesResult;
    if (bal.address && bal.chain) {
      onSessionUpdate({
        connectedAddress: bal.address,
        lastWalletPortfolio: snapshotFromWalletBalances(bal),
        lastBalance: {
          chain: bal.chain,
          address: bal.address,
          wei: nativeBalanceToWeiHex(bal.nativeBalance),
        },
      });
    }
  }

  const subject = querySubject(intent.method);
  if (subject) {
    onSessionUpdate({
      lastQuery: {
        chain: intent.chain,
        method: intent.method,
        subject,
        params: subject === "balance" && typeof intent.params[0] === "string" ? [intent.params[0]] : [],
      },
    });
  }
}

async function* runSingleIntentRoute(
  input: RouteQueryInput,
  pocket: PocketClient,
): AsyncGenerator<AgentEvent> {
  const nlRpc = createNlRpcEngine();

  yield {
    type: "status",
    data: { message: "Parsing query…", phase: "parse" },
  };

  const parsed = await nlRpc.parse(input.query, input.sessionContext);

  yield {
    type: "status",
    data: {
      message: parsed.intent.humanSummary ?? `Executing ${parsed.intent.method} on ${parsed.intent.chain}`,
      phase: "execute",
    },
  };

  if (parsed.requiresConfirmation) {
    yield {
      type: "result",
      data: {
        route: "intent" as QueryRoute,
        requiresConfirmation: true,
        intent: parsed.intent,
        pendingAction: parsed.pendingAction,
        message: "This action requires wallet confirmation.",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const start = Date.now();
  let output = await executeIntent(pocket, parsed.intent);
  output = enrichOutputWithAssessment(parsed.intent, output);
  rememberFromIntent(parsed.intent, output, input.onSessionUpdate);

  let summary = formatResultSummary(parsed.intent, output, input.query);
  let interpreted = false;
  if (needsResultInterpretation(input.query, parsed.intent)) {
    yield {
      type: "status",
      data: { message: "Interpreting result…", phase: "interpret" },
    };
    const llmConfig = loadLlmConfig();
    const wrapped =
      llmConfig?.enabled
        ? await interpretQueryResult(input.query, parsed.intent, output, llmConfig)
        : formatInterpretationFallback(input.query, parsed.intent, output);
    if (wrapped) {
      summary = `\n${wrapped}`;
      interpreted = true;
    }
  }

  const interpretationContext = interpreted
    ? {
        userQuery: input.query,
        structuredFacts: buildInterpretationFacts(parsed.intent, output),
        dataSource: "pocket_network_rpc",
      }
    : undefined;

  yield {
    type: "result",
    data: {
      route: "intent" as QueryRoute,
      intent: parsed.intent,
      output,
      answer: summary.trim(),
      naturalLanguageSummary: summary.trim(),
      interpretationContext,
      latencyMs: Date.now() - start,
    },
  };
  yield { type: "token", data: { text: summary } };
  yield { type: "done", data: {} };
}

async function* runAgentRoute(input: RouteQueryInput, pocket: PocketClient): AsyncGenerator<AgentEvent> {
  yield* runAgentLoop({
    query: input.query,
    sessionContext: input.sessionContext,
    pocket,
  });
}

export async function* routeQuery(input: RouteQueryInput): AsyncGenerator<AgentEvent> {
  const pocket = input.pocket ?? createPocketClient();
  const agentEnabled = isAgentLoopEnabled();

  yield {
    type: "status",
    data: { message: "Routing query…", phase: "route" },
  };

  if (isSendStatusQuery(input.query)) {
    yield* runSendStatusRoute(input.sessionContext, pocket, input.onSessionUpdate);
    return;
  }

  if (isSwapStatusQuery(input.query)) {
    const intentMcp = loadIntentMcpConfig();
    if (intentMcp) {
      yield* runIntentSwapStatusRoute(input.sessionContext, intentMcp, input.onSessionUpdate);
      return;
    }
    yield {
      type: "error",
      data: {
        message:
          "Swap status requires Intent MCP. Set INTENT_MCP_API_KEY on the API server and submit a swap in this session first.",
        code: "INTENT_MCP_NOT_CONFIGURED",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  if (isSwapQuery(input.query)) {
    const intentMcp = loadIntentMcpConfig();
    if (intentMcp) {
      yield* runIntentSwapRoute(input.query, input.sessionContext, intentMcp);
      return;
    }
    yield {
      type: "error",
      data: {
        message:
          "pokt-mcp does not execute token swaps without Intent MCP. Set INTENT_MCP_API_KEY on the API server (uses INTENT_MCP_REMOTE_URL — same as Cursor mcp-remote — by default), or configure intent-mcp in Cursor. See docs/USE_CASES.md#third-party-mcp-integrations-optional",
        requiresThirdPartySwapMcp: true,
        thirdPartyExample: "intent-mcp",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  try {
    yield* runSingleIntentRoute(input, pocket);
  } catch (err) {
    if (isWalletNotConnectedError(err)) {
      yield {
        type: "error",
        data: {
          message: "Connect your wallet to check your balance.",
          code: "WALLET_NOT_CONNECTED",
        },
      };
      yield { type: "done", data: {} };
      return;
    }
    if (agentEnabled && (isParseFailedError(err) || isExecutionFailedError(err))) {
      for await (const event of runAgentRoute(input, pocket)) {
        if (event.type === "result") {
          yield {
            type: "result",
            data: { ...(event.data as object), route: "agent", fallbackUsed: true },
          };
        } else {
          yield event;
        }
      }
      return;
    }
    yield { type: "error", data: { message: err instanceof Error ? err.message : String(err) } };
    yield { type: "done", data: {} };
  }
}

function isWalletNotConnectedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("WALLET_NOT_CONNECTED");
}

export async function collectRouteQueryResult(input: RouteQueryInput): Promise<{
  route?: QueryRoute;
  answer?: string;
  intent?: RpcIntent;
  output?: unknown;
  steps?: Array<{ tool: string; args: unknown; result: unknown }>;
  error?: string;
  requiresConfirmation?: boolean;
  fallbackUsed?: boolean;
}> {
  let route: QueryRoute | undefined;
  let answer: string | undefined;
  let intent: RpcIntent | undefined;
  let output: unknown;
  let steps: Array<{ tool: string; args: unknown; result: unknown }> | undefined;
  let error: string | undefined;
  let requiresConfirmation = false;
  let triedIntent = false;
  let usedAgent = false;
  let fallbackUsed = false;

  for await (const event of routeQuery(input)) {
    if (event.type === "result") {
      const data = event.data as {
        route?: QueryRoute;
        answer?: string;
        intent?: RpcIntent;
        output?: unknown;
        steps?: Array<{ tool: string; args: unknown; result: unknown }>;
        requiresConfirmation?: boolean;
        fallbackUsed?: boolean;
      };
      if (data.route === "intent") triedIntent = true;
      if (data.route === "agent" || data.steps) usedAgent = true;
      if (data.fallbackUsed) fallbackUsed = true;
      route = data.route ?? (data.steps ? "agent" : route);
      if (data.answer) answer = data.answer;
      if (data.intent) intent = data.intent;
      if (data.output !== undefined) output = data.output;
      if (data.steps) steps = data.steps;
      if (data.requiresConfirmation) requiresConfirmation = true;
    }
    if (event.type === "token") {
      const data = event.data as { text?: string };
      if (data.text && !answer) answer = data.text.trim();
    }
    if (event.type === "error") {
      error = (event.data as { message: string }).message;
    }
  }

  return {
    route: route ?? (usedAgent ? "agent" : triedIntent ? "intent" : undefined),
    answer,
    intent,
    output,
    steps,
    error,
    requiresConfirmation,
    fallbackUsed: fallbackUsed || (triedIntent && usedAgent),
  };
}

function enrichOutputWithAssessment(intent: RpcIntent, output: unknown): unknown {
  const o = output as { result?: unknown; gasGwei?: number; gasAssessment?: ReturnType<typeof assessGasPrice> };
  if (intent.method === "eth_gasPrice" && typeof o.result === "string") {
    const gwei = gweiFromHex(o.result);
    return { ...o, gasGwei: gwei, gasAssessment: assessGasPrice(gwei, intent.chain) };
  }
  if (intent.method === "__query_at_time__" && o.gasGwei !== undefined) {
    const chain = (o as { chain?: string }).chain ?? intent.chain;
    return { ...o, gasAssessment: assessGasPrice(o.gasGwei, chain) };
  }
  return output;
}

function formatResultSummary(intent: RpcIntent, output: unknown, query?: string): string {
  const o = output as {
    result?: unknown;
    chains?: unknown[];
    gasGwei?: number;
    gasAssessment?: ReturnType<typeof assessGasPrice>;
  };
  const chain = intent.chain;

  if (intent.method === "eth_blockNumber" && typeof o.result === "string") {
    return `\nLatest block on ${chain}: #${BigInt(o.result).toString()}`;
  }
  if (intent.method === "eth_getBalance" && typeof o.result === "string") {
    const eth = Number(BigInt(o.result)) / 1e18;
    return `\nBalance on ${chain}: ${eth.toFixed(6)} native`;
  }
  if (intent.method === "eth_gasPrice" && typeof o.result === "string") {
    const gwei = o.gasGwei ?? gweiFromHex(o.result);
    if (query && wantsGasAssessment(query) && o.gasAssessment) {
      return `\n${formatGasAssessmentMessage(chain, o.gasAssessment)}`;
    }
    return `\nGas price on ${chain}: ${gwei.toFixed(2)} gwei`;
  }
  if (intent.method === "eth_getTransactionCount" && typeof o.result === "string") {
    return `\nNonce on ${chain}: ${BigInt(o.result).toString()}`;
  }
  if (
    (intent.method === "eth_getTransactionByHash" || intent.method === "eth_getTransactionReceipt") &&
    o.result == null
  ) {
    const notFound = (o as { notFound?: import("@pokt-mcp/nl-rpc").TxNotFoundInfo }).notFound;
    if (notFound) return `\n${formatTxNotFoundMessage(notFound)}`;
    const hash = typeof intent.params[0] === "string" ? intent.params[0] : "unknown";
    return `\nNo transaction found for ${hash} on ${chain}.`;
  }
  if (intent.method === "__list_chains__" && Array.isArray(o.chains)) {
    return `\n${o.chains.length} Pocket chains available.`;
  }
  if (intent.method === "__market_analytics_unsupported__" && typeof (o as { message?: string }).message === "string") {
    return `\n${formatMarketAnalyticsUnsupported(o as import("@pokt-mcp/nl-rpc").MarketAnalyticsUnsupportedResult)}`;
  }
  if (intent.method === "__assistant_info__" && typeof (o as { message?: string }).message === "string") {
    return `\n${(o as { message: string }).message}`;
  }
  if (intent.method === "__native_convert__") {
    const conv = o as {
      nativeAmount?: string;
      nativeSymbol?: string;
      convertedAmount?: number;
      rate?: number;
      targetSymbol?: string;
      targetVs?: string;
    };
    if (conv.convertedAmount !== undefined && conv.nativeAmount !== undefined) {
      const formatted = formatConvertedAmount(
        conv.convertedAmount,
        conv.targetSymbol ?? "USD",
        conv.targetVs ?? "usd",
      );
      const price = formatConvertedAmount(conv.rate ?? 0, conv.targetSymbol ?? "USD", conv.targetVs ?? "usd");
      const target = conv.targetSymbol ?? "USD";
      return `\n${conv.nativeAmount} ${conv.nativeSymbol ?? "native"} ≈ ${formatted} ${target} (@ ${price} ${target} / ${conv.nativeSymbol ?? "native"})`;
    }
  }
  if (intent.method === "__wallet_portfolio_convert__") {
    return formatPortfolioConversion(output as import("@pokt-mcp/nl-rpc").PortfolioConvertResult);
  }
  if (intent.method === "__price_change_24h__") {
    const change = output as import("@pokt-mcp/nl-rpc").PriceChange24hResult;
    if (change.changePercent24h !== undefined) {
      return `\n${formatPriceChange24h(change)}`;
    }
  }
  if (intent.method === "__spot_price__") {
    const spot = output as {
      symbol?: string;
      vsSymbol?: string;
      vsCurrency?: string;
      price?: number;
    };
    if (spot.price !== undefined && spot.symbol) {
      const formatted = formatSpotPrice(spot.price, spot.vsSymbol ?? "USD", spot.vsCurrency ?? "usd");
      return `\n${spot.symbol} spot price: ${formatted}`;
    }
  }
  if (intent.method === "__query_at_time__") {
    const hist = output as {
      subject?: string;
      offsetLabel?: string;
      gasGwei?: number;
      balanceNative?: string;
      blockNumber?: string;
      blockTimeIso?: string;
      chain?: string;
    };
    const ch = hist.chain ?? chain;
    if (hist.subject === "gas" && hist.gasGwei !== undefined) {
      return `\nGas price on ${ch} ${hist.offsetLabel ?? "earlier"}: ${hist.gasGwei.toFixed(2)} gwei (block ${BigInt(hist.blockNumber ?? "0x0").toString()} @ ${hist.blockTimeIso ?? "unknown"})`;
    }
    if (hist.subject === "balance" && hist.balanceNative !== undefined) {
      return `\nBalance on ${ch} ${hist.offsetLabel ?? "earlier"}: ${hist.balanceNative} native (block ${BigInt(hist.blockNumber ?? "0x0").toString()})`;
    }
    if (hist.subject === "blockNumber" && hist.blockNumber) {
      return `\nBlock on ${ch} ${hist.offsetLabel ?? "earlier"}: #${BigInt(hist.blockNumber).toString()} (@ ${hist.blockTimeIso ?? "unknown"})`;
    }
  }
  if (intent.method === "__wallet_balances_multi__") {
    return formatMultiWalletBalances(output as import("@pokt-mcp/nl-rpc").MultiWalletBalancesResult);
  }
  if (intent.method === "__wallet_balances__") {
    return formatWalletBalances(output as WalletBalancesResult);
  }
  if (intent.method === "__tx_history__") {
    return formatTxHistory(output as import("@pokt-mcp/nl-rpc").TxHistoryResult);
  }
  if (intent.method === "__payment_from_me__") {
    return formatPaymentFromMe(output as import("@pokt-mcp/nl-rpc").PaymentFromMeResult);
  }
  if (intent.method === "__compare_gas__") {
    return formatCompareGas(output as import("@pokt-mcp/nl-rpc").CompareGasResult);
  }
  if (intent.method === "__erc20_balance__") {
    return formatErc20Balance(output as import("@pokt-mcp/nl-rpc").Erc20BalanceResult);
  }
  if (intent.method === "__transfer_events__") {
    return formatTransferEvents(output as import("@pokt-mcp/nl-rpc").TransferEventsResult);
  }
  if (intent.method === "eth_getCode" && typeof o.result === "string") {
    const addr = typeof intent.params[0] === "string" ? intent.params[0] : "unknown";
    const code = o.result;
    if (code === "0x" || code === "0x0") {
      return `\nNo contract bytecode at ${addr} on ${chain} (externally owned account or empty).`;
    }
    const byteLen = (code.length - 2) / 2;
    return `\nContract bytecode at ${addr} on ${chain}: ${byteLen.toLocaleString()} bytes (via eth_getCode).`;
  }
  if (intent.method === "__solana_slot__") {
    const slot = (output as { slot?: number }).slot;
    return slot != null ? `\nLatest Solana slot: ${slot}` : "\nLatest Solana slot fetched.";
  }
  if (intent.method === "__solana_balance__") {
    const bal = output as { sol?: number; address?: string };
    if (bal.sol != null) return `\nSOL balance for ${bal.address}: ${bal.sol} SOL`;
  }
  if (intent.method === "__ens_balance__" && o.result) {
    return `\nENS balance resolved on eth.`;
  }
  return `\n${intent.humanSummary}`;
}
