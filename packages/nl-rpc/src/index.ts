import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { loadLlmConfig, type LlmConfig, type RpcIntent, type SessionContext } from "@pokt-mcp/shared";
import type { NlParseResult, NlRpcEngine } from "./types.js";
import { getEnsBalance } from "./ens.js";
import { parseWithLlm } from "./llm.js";
import { buildAssistantInfoMessage, buildDataSourcesInfoMessage, matchMetaQuery } from "./meta.js";
import { inferChain, matchTemplate } from "./templates/index.js";
import { inferIntentHeuristic } from "./heuristic.js";
import { convertNativeAmount, formatConvertedAmount, matchConvertQuery } from "./convert.js";
import { matchTemporalQuery, queryAtTime } from "./temporal.js";
import { matchWalletBalanceQuery, executeWalletBalances, executeWalletBalancesMulti, nativeBalanceToWeiHex, type MultiWalletBalancesResult, type WalletBalancesResult } from "./wallet-balance.js";
import { matchCompareGasQuery, executeCompareGas, formatCompareGas } from "./compare-gas.js";
import { fetchTxHistory, fetchPaymentFromMe, matchTxHistoryQuery, matchPaymentFromMeQuery } from "./tx-history.js";
import {
  fetchPriceChange24h,
  fetchSpotPrice,
  formatPriceChange24h,
  formatSpotPrice,
  matchPriceChangeQuery,
  matchSpotPriceQuery,
} from "./price.js";
import { executeErc20Balance } from "./erc20-balance.js";
import { executeTransferEvents, matchTransferEventQuery } from "./transfer-logs.js";
import {
  convertWalletPortfolio,
  snapshotFromMultiWalletBalances,
  snapshotFromWalletBalances,
} from "./portfolio-convert.js";
import { enrichTxLookupOutput } from "./tx-lookup.js";
import {
  executeMarketAnalyticsUnsupported,
  matchMarketAnalyticsQuery,
} from "./market-analytics.js";

export interface NlRpcEngineOptions {
  llm?: LlmConfig | null;
}

function buildParseFailedError(llmConfig: LlmConfig | null): string {
  const base = "NL_PARSE_FAILED: could not parse query.";
  if (!llmConfig?.enabled) {
    return `${base} No template or heuristic match. Common RPC queries (blocks, balances, gas, chains) are supported. For broader natural language, set FEATURE_NL_LLM=true and configure LLM_PROVIDER. Or use pocket_rpc_call with explicit method/params.`;
  }
  return `${base} Try rephrasing as a blockchain query, use pocket_agent_query for complex multi-step queries, or use pocket_rpc_call with explicit method/params.`;
}

function validateLlmIntent(intent: RpcIntent): void {
  const chainInfo = resolveChain(intent.chain);
  if (!chainInfo) {
    throw new Error(
      `NL_PARSE_FAILED: unknown chain slug "${intent.chain}" from LLM. Use pocket_query or a valid chain slug from list_chains.`,
    );
  }
}

function wrapIntent(intent: RpcIntent, forceConfirm = false): NlParseResult {
  const isWrite = intent.action === "write" || intent.riskLevel === "high";
  return {
    intent,
    pendingAction: isWrite ? "wallet_send_transaction" : undefined,
    requiresConfirmation: isWrite || forceConfirm,
  };
}

export function createNlRpcEngine(options?: NlRpcEngineOptions): NlRpcEngine {
  const llmConfig = options?.llm !== undefined ? options.llm : loadLlmConfig();

  return {
    async parse(query: string, context?: SessionContext): Promise<NlParseResult> {
      const metaResult = matchMetaQuery(query);
      if (metaResult) {
        return wrapIntent(metaResult);
      }

      const chain = inferChain(query, context);

      const walletBalanceResult = matchWalletBalanceQuery(query, context);
      if (walletBalanceResult) {
        return wrapIntent(walletBalanceResult);
      }

      const txHistoryResult = matchTxHistoryQuery(query, context);
      if (txHistoryResult) {
        return wrapIntent(txHistoryResult);
      }

      const paymentFromMeResult = matchPaymentFromMeQuery(query, context);
      if (paymentFromMeResult) {
        return wrapIntent(paymentFromMeResult);
      }

      const compareGasResult = matchCompareGasQuery(query, context);
      if (compareGasResult) {
        return wrapIntent(compareGasResult);
      }

      const transferEventsResult = matchTransferEventQuery(query, context);
      if (transferEventsResult) {
        return wrapIntent(transferEventsResult);
      }

      const marketAnalyticsResult = matchMarketAnalyticsQuery(query, context);
      if (marketAnalyticsResult) {
        return wrapIntent(marketAnalyticsResult);
      }

      const priceChangeResult = matchPriceChangeQuery(query, chain);
      if (priceChangeResult) {
        return wrapIntent(priceChangeResult);
      }

      const convertResult = matchConvertQuery(query, chain, context);
      if (convertResult) {
        return wrapIntent(convertResult);
      }

      const spotPriceResult = matchSpotPriceQuery(query, chain);
      if (spotPriceResult) {
        return wrapIntent(spotPriceResult);
      }

      const temporalResult = matchTemporalQuery(query, chain, context);
      if (temporalResult) {
        return wrapIntent(temporalResult);
      }

      const templateResult = matchTemplate(query, chain);
      if (templateResult) {
        const forceConfirm = templateResult.action === "write";
        return wrapIntent(templateResult, forceConfirm);
      }

      const heuristicResult = inferIntentHeuristic(query, context);
      if (heuristicResult) {
        return wrapIntent(heuristicResult, heuristicResult.action === "write");
      }

      if (llmConfig?.enabled) {
        const llmResult = await parseWithLlm(query, chain, llmConfig, context);
        if (llmResult) {
          validateLlmIntent(llmResult);
          return wrapIntent(llmResult, llmResult.action === "write");
        }
      }

      throw new Error(buildParseFailedError(llmConfig));
    },

    explain(method: string, params: unknown[], chain: string) {
      if (method === "__list_chains__") return `Would list Pocket chains`;
      if (method === "__assistant_info__") return `Would return assistant and model information`;
      if (method === "__ens_balance__") return `Would resolve ENS ${params[0]} and fetch balance on eth`;
      if (method === "__native_convert__") return `Would convert native balance on ${chain}`;
      if (method === "__price_change_24h__") return `Would fetch 24h price change`;
      if (method === "__spot_price__") return `Would fetch spot price on ${chain}`;
      if (method === "__query_at_time__") return `Would look up historical value on ${chain}`;
      if (method === "__tx_history__") return `Would fetch recent transactions on ${chain}`;
      if (method === "__compare_gas__") return `Would compare gas prices across chains via Pocket RPC`;
      if (method === "__payment_from_me__") return `Would check if an address received funds from your wallet on ${chain}`;
      if (method === "__wallet_balances_multi__") return `Would fetch wallet balances across Pocket mainnets`;
      if (method === "__wallet_balances__") return `Would fetch wallet balances on ${chain}`;
      if (method === "__wallet_portfolio_convert__") return `Would convert wallet portfolio to target currency`;
      if (method === "__erc20_balance__") return `Would fetch ERC-20 balance on ${chain}`;
      if (method === "__transfer_events__") return `Would fetch ERC-20 Transfer event logs on ${chain}`;
      if (method === "__market_analytics_unsupported__") return `Would explain trading-volume ranking limits on ${chain}`;
      if (method === "__solana_balance__") return `Would fetch SOL balance on solana`;
      if (method === "__solana_slot__") return `Would fetch latest slot on solana`;
      return `Would call ${method} on chain "${chain}" with params: ${JSON.stringify(params)}`;
    },
  };
}

export async function executeIntent(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  intent: RpcIntent,
): Promise<unknown> {
  if (intent.method === "__list_chains__") {
    return { chains: listChains() };
  }
  if (intent.method === "__assistant_info__") {
    const topic = intent.params[0] as string | undefined;
    if (topic === "data_sources") {
      return { message: buildDataSourcesInfoMessage() };
    }
    return { message: buildAssistantInfoMessage(loadLlmConfig()) };
  }
  if (intent.method === "__ens_balance__") {
    const name = intent.params[0] as string;
    return getEnsBalance(pocket, name);
  }
  if (intent.method === "__native_convert__") {
    const [chain, value, mode, targetVs, targetSymbol, address] = intent.params as [
      string,
      string,
      "address" | "wei",
      string,
      string,
      string?,
    ];
    let wei = value;
    let resolvedAddress = address;
    if (mode === "address") {
      const resp = await pocket.rpc(chain, "eth_getBalance", [value, "latest"]);
      wei = resp.result as string;
      resolvedAddress = value;
    }
    return convertNativeAmount(chain, wei, targetVs, targetSymbol, resolvedAddress);
  }
  if (intent.method === "__price_change_24h__") {
    const [coingeckoId, symbol] = intent.params as [string, string];
    return fetchPriceChange24h(coingeckoId, symbol);
  }
  if (intent.method === "__spot_price__") {
    const [coingeckoId, symbol, vsCurrency, vsSymbol] = intent.params as [string, string, string, string];
    return fetchSpotPrice(coingeckoId, symbol, vsCurrency, vsSymbol);
  }
  if (intent.method === "__query_at_time__") {
    const [chain, subject, offsetSeconds, ...extra] = intent.params as [
      string,
      import("./temporal.js").TemporalSubject,
      number,
      ...unknown[],
    ];
    return queryAtTime(pocket, chain, subject, offsetSeconds, extra);
  }
  if (intent.method === "__erc20_balance__") {
    const [chain, symbol, address] = intent.params as [string, string, string];
    return executeErc20Balance(pocket, chain, symbol, address);
  }
  if (intent.method === "__transfer_events__") {
    const [chain, symbol, walletAddress, blockRange] = intent.params as [
      string,
      string,
      string,
      number,
    ];
    return executeTransferEvents(pocket, chain, symbol, walletAddress, blockRange);
  }
  if (intent.method === "__market_analytics_unsupported__") {
    const [chainName] = intent.params as [string];
    return executeMarketAnalyticsUnsupported(chainName);
  }
  if (intent.method === "__solana_slot__") {
    const resp = await pocket.rpc("solana", "getSlot", []);
    return { slot: resp.result, meta: resp.meta };
  }
  if (intent.method === "__solana_balance__") {
    const [pubkey] = intent.params as [string];
    const resp = await pocket.rpc("solana", "getBalance", [pubkey]);
    const value = (resp.result as { value?: number })?.value ?? resp.result;
    const lamports = typeof value === "number" ? value : Number(value);
    return {
      address: pubkey,
      lamports,
      sol: lamports / 1e9,
      meta: resp.meta,
    };
  }
  if (intent.method === "__tx_history__") {
    const [chain, address, limit] = intent.params as [string, string, number];
    return fetchTxHistory(pocket, chain, address, limit);
  }
  if (intent.method === "__payment_from_me__") {
    const [chain, fromAddress, toAddress] = intent.params as [string, string, string];
    return fetchPaymentFromMe(pocket, chain, fromAddress, toAddress);
  }
  if (intent.method === "__compare_gas__") {
    return executeCompareGas(pocket, intent.params as string[]);
  }
  if (intent.method === "__wallet_balances_multi__") {
    const [address] = intent.params as [string];
    return executeWalletBalancesMulti(pocket, address);
  }
  if (intent.method === "__wallet_balances__") {
    const [chain, address] = intent.params as [string, string];
    return executeWalletBalances(pocket, chain, address);
  }
  if (intent.method === "__wallet_portfolio_convert__") {
    const [portfolio, targetVs, targetSymbol] = intent.params as [
      import("@pokt-mcp/shared").WalletPortfolioSnapshot,
      string,
      string,
    ];
    return convertWalletPortfolio(portfolio, targetVs, targetSymbol);
  }
  validateRpcParams(intent.method, intent.params);
  const resp = await pocket.rpc(intent.chain, intent.method, intent.params);
  return enrichTxLookupOutput(intent.method, intent.chain, intent.params, {
    result: resp.result,
    meta: resp.meta,
  });
}

function validateRpcParams(method: string, params: unknown[]): void {
  const needsAddress: Record<string, number> = {
    eth_getBalance: 1,
    eth_getTransactionCount: 1,
    eth_getCode: 1,
  };
  const minParams = needsAddress[method];
  if (minParams !== undefined && params.length < minParams) {
    throw new Error(
      `NL_PARSE_FAILED: ${method} requires ${minParams} param(s) but got ${params.length}. Try rephrasing or use pocket_rpc_call with explicit params.`,
    );
  }
  if (method === "eth_getBlockByNumber" && params.length < 1) {
    throw new Error("NL_PARSE_FAILED: eth_getBlockByNumber requires a block tag or number.");
  }
}

export * from "./types.js";
export {
  buildAssistantInfoMessage,
  buildDataSourcesInfoMessage,
  isMetaQuery,
  matchMetaQuery,
} from "./meta.js";
export {
  convertNativeAmount,
  formatConvertedAmount,
  isTokenQuoteQuery,
  matchConvertQuery,
  parseTargetAsset,
  type ConvertResult,
  type ConvertTarget,
} from "./convert.js";
export {
  formatTimeOffsetLabel,
  estimateBlockSearchWindow,
  matchTemporalQuery,
  parseTimeOffsetSeconds,
  queryAtTime,
  type QueryAtTimeResult,
  type TemporalSubject,
} from "./temporal.js";
export {
  fetchPriceChange24h,
  fetchSpotPrice,
  formatPriceChange24h,
  formatSpotPrice,
  isPriceChangeQuery,
  isSpotPriceQuery,
  matchPriceChangeQuery,
  matchSpotPriceQuery,
  type PriceChange24hResult,
  type SpotPriceResult,
} from "./price.js";
export { needsDynamicRouting } from "./routing.js";
export { formatKnownTokensForPrompt, KNOWN_TOKENS } from "./tokens.js";
export {
  DEFAULT_COMPARE_GAS_CHAINS,
  executeCompareGas,
  extractCompareChains,
  formatCompareGas,
  isCompareGasQuery,
  matchCompareGasQuery,
  resolveCompareGasChains,
  wantsMultiChainGasCompare,
  type CompareGasResult,
} from "./compare-gas.js";
export {
  fetchPaymentFromMe,
  fetchTxHistory,
  formatPaymentFromMe,
  formatTxHistory,
  isPaymentFromMeQuery,
  isTxHistoryQuery,
  matchPaymentFromMeQuery,
  matchTxHistoryQuery,
  type PaymentFromMeResult,
  type TxHistoryEntry,
  type TxHistoryResult,
} from "./tx-history.js";
export {
  executeWalletBalances,
  executeWalletBalancesMulti,
  formatMultiWalletBalances,
  formatWalletBalances,
  isWalletBalanceQuery,
  matchWalletBalanceQuery,
  nativeBalanceToWeiHex,
  wantsMyWallet,
  type MultiWalletBalancesResult,
  type WalletBalancesResult,
  type WalletTokenBalance,
} from "./wallet-balance.js";
export {
  executeErc20Balance,
  formatErc20Balance,
  getErc20TokenBalance,
  matchErc20BalanceQuery,
  type Erc20BalanceResult,
} from "./erc20-balance.js";
export {
  executeTransferEvents,
  formatTransferEvents,
  isTransferEventQuery,
  matchTransferEventQuery,
  wantsTransferEvents,
  type TransferEventEntry,
  type TransferEventsResult,
} from "./transfer-logs.js";
export { isContractCodeQuery, wantsContractCode, wantsSend } from "./patterns.js";
export {
  convertWalletPortfolio,
  formatPortfolioConversion,
  snapshotFromMultiWalletBalances,
  snapshotFromWalletBalances,
  type PortfolioConvertResult,
} from "./portfolio-convert.js";
export {
  assessGasPrice,
  formatGasAssessmentMessage,
  gweiFromHex,
  wantsGasAssessment,
  type GasAssessment,
  type GasAssessmentLevel,
} from "./gas-assessment.js";
export {
  buildInterpretationFacts,
  formatInterpretationFallback,
  interpretQueryResult,
  needsResultInterpretation,
} from "./interpret.js";
export {
  buildTxNotFoundInfo,
  enrichTxLookupOutput,
  formatTxNotFoundMessage,
  isTxLookupMethod,
  wantsTxExplain,
  type TxNotFoundInfo,
} from "./tx-lookup.js";
export {
  executeMarketAnalyticsUnsupported,
  formatMarketAnalyticsUnsupported,
  isMarketAnalyticsQuery,
  matchMarketAnalyticsQuery,
  type MarketAnalyticsUnsupportedResult,
} from "./market-analytics.js";
