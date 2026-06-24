import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { loadLlmConfig, prepareSanitizedQueryInput, sanitizeIntentForMcp, type ChatHistoryMessage, type LlmConfig, type LlmStreamCallbacks, type RpcIntent, type SessionContext } from "@pokt-mcp/shared";
import type { NlParseResult, NlRpcEngine } from "./types.js";
import { getEnsBalance } from "./ens.js";
import { parseWithLlm } from "./llm.js";
import { buildAssistantInfoMessage, buildDataSourcesInfoMessage, buildGreetingMessage, matchMetaQuery } from "./meta.js";
import { inferChain, matchTemplate } from "./templates/index.js";
import { inferIntentHeuristic } from "./heuristic.js";
import { convertNativeAmount, formatConvertedAmount, matchConvertQuery } from "./convert.js";
import { matchTemporalQuery, matchTemporalFollowUp, queryAtTime } from "./temporal.js";
import { matchWalletBalanceQuery, executeWalletBalances, executeWalletBalancesMulti, nativeBalanceToWeiHex, type MultiWalletBalancesResult, type WalletBalancesResult } from "./wallet-balance.js";
import { matchCompareGasQuery, executeCompareGas, formatCompareGas } from "./compare-gas.js";
import { matchGasFiatQuery, executeGasFiat, formatGasFiat, isGasFiatQuery } from "./gas-fiat.js";
import {
  matchCompareBalancesQuery,
  executeCompareBalances,
  formatCompareBalances,
} from "./compare-balances.js";
import { matchCosmosBalanceQuery, fetchCosmosBalances, formatCosmosBalances } from "./cosmos-balance.js";
import {
  executeAccountAudit,
  matchAccountAuditQuery,
  type AccountAuditOptions,
} from "./account-audit.js";
import { fetchTxHistory, fetchPaymentFromMe, matchTxHistoryQuery, matchPaymentFromMeQuery } from "./tx-history.js";
import {
  fetchPriceChange,
  fetchPriceChange24h,
  fetchSpotPrice,
  formatPriceChange,
  formatPriceChange24h,
  formatSpotPrice,
  formatUnsupportedMarketPeriodMessage,
  matchPriceChangeFollowUp,
  matchPriceChangeQuery,
  matchSpotPriceQuery,
  matchUnsupportedMarketPeriodQuery,
  isUnmappedMarketDurationFollowUp,
  type PriceChangePeriod,
} from "./price.js";
import { executeErc20Balance } from "./erc20-balance.js";
import { executeTransferEvents, matchTransferEventQuery, matchTransferEventFollowUp } from "./transfer-logs.js";
import {
  convertWalletPortfolio,
  snapshotFromMultiWalletBalances,
  snapshotFromWalletBalances,
} from "./portfolio-convert.js";
import { enrichTxLookupOutput, isTxLookupMethod, pollTxLookup } from "./tx-lookup.js";
import { expandFollowUpQuery } from "./context.js";
import {
  executeMarketAnalyticsUnsupported,
  fetchAssetTradingVolume,
  matchMarketAnalyticsQuery,
} from "./market-analytics.js";
import { executeGetChain, formatGetChain } from "./chain-metadata.js";
import { executeWalletHealth, matchWalletHealthQuery } from "./wallet-health.js";
import { executeTokenResearch, matchTokenResearchQuery } from "./token-research.js";
import { executeContractExplainer, matchContractExplainerQuery } from "./contract-explainer.js";
import { executeGovernance, matchGovernanceQuery } from "./governance.js";
import { executeScamScan, matchScamScanQuery } from "./scam-scan.js";
import { executeDefiPositions, matchDefiPositionsQuery } from "./defi-positions.js";
import { executeOperatorStatus, matchOperatorStatusQuery } from "./operator-status.js";
import { matchTokenSendQuery } from "./token-send.js";

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
    async parse(
      query: string,
      context?: SessionContext,
      history?: ChatHistoryMessage[],
      stream?: LlmStreamCallbacks,
    ): Promise<NlParseResult> {
      const { query: safeQuery, history: safeHistory, sessionContext: safeContext } =
        prepareSanitizedQueryInput({ query, history, sessionContext: context });
      const effectiveQuery = expandFollowUpQuery(safeQuery, safeHistory);

      const metaResult = matchMetaQuery(safeQuery);
      if (metaResult) {
        return wrapIntent(metaResult);
      }

      const chain = inferChain(effectiveQuery, safeContext);

      const tokenSendResult = matchTokenSendQuery(effectiveQuery, safeContext);
      if (tokenSendResult) {
        return wrapIntent(tokenSendResult, true);
      }

      const operatorStatusResult = matchOperatorStatusQuery(effectiveQuery, safeContext);
      if (operatorStatusResult) {
        return wrapIntent(operatorStatusResult);
      }

      const governanceResult = matchGovernanceQuery(effectiveQuery, safeContext);
      if (governanceResult) {
        return wrapIntent(governanceResult);
      }

      const scamScanResult = matchScamScanQuery(effectiveQuery, safeContext);
      if (scamScanResult) {
        return wrapIntent(scamScanResult);
      }

      const walletHealthResult = matchWalletHealthQuery(effectiveQuery, safeContext);
      if (walletHealthResult) {
        return wrapIntent(walletHealthResult);
      }

      const tokenResearchResult = matchTokenResearchQuery(effectiveQuery, safeContext);
      if (tokenResearchResult) {
        return wrapIntent(tokenResearchResult);
      }

      const contractExplainerResult = matchContractExplainerQuery(effectiveQuery, safeContext);
      if (contractExplainerResult) {
        return wrapIntent(contractExplainerResult);
      }

      const defiPositionsResult = matchDefiPositionsQuery(effectiveQuery, safeContext);
      if (defiPositionsResult) {
        return wrapIntent(defiPositionsResult);
      }

      const walletBalanceResult = matchWalletBalanceQuery(effectiveQuery, safeContext);
      if (walletBalanceResult) {
        return wrapIntent(walletBalanceResult);
      }

      const accountAuditResult = matchAccountAuditQuery(effectiveQuery, safeContext);
      if (accountAuditResult) {
        return wrapIntent(accountAuditResult);
      }

      const txHistoryResult = matchTxHistoryQuery(effectiveQuery, safeContext);
      if (txHistoryResult) {
        return wrapIntent(txHistoryResult);
      }

      const paymentFromMeResult = matchPaymentFromMeQuery(effectiveQuery, safeContext);
      if (paymentFromMeResult) {
        return wrapIntent(paymentFromMeResult);
      }

      const compareGasResult = matchCompareGasQuery(effectiveQuery, safeContext);
      if (compareGasResult) {
        return wrapIntent(compareGasResult);
      }

      const gasFiatResult = matchGasFiatQuery(effectiveQuery, chain);
      if (gasFiatResult) {
        return wrapIntent(gasFiatResult);
      }

      const compareBalancesResult = matchCompareBalancesQuery(effectiveQuery, safeContext);
      if (compareBalancesResult) {
        return wrapIntent(compareBalancesResult);
      }

      const cosmosBalanceResult = matchCosmosBalanceQuery(effectiveQuery, safeContext);
      if (cosmosBalanceResult) {
        return wrapIntent(cosmosBalanceResult);
      }

      const transferFollowUp = matchTransferEventFollowUp(safeQuery, safeContext, safeHistory);
      if (transferFollowUp) {
        return wrapIntent(transferFollowUp);
      }

      const transferEventsResult = matchTransferEventQuery(effectiveQuery, safeContext);
      if (transferEventsResult) {
        return wrapIntent(transferEventsResult);
      }

      const marketAnalyticsResult = matchMarketAnalyticsQuery(effectiveQuery, safeContext);
      if (marketAnalyticsResult) {
        return wrapIntent(marketAnalyticsResult);
      }

      const unsupportedPeriod = matchUnsupportedMarketPeriodQuery(safeQuery, effectiveQuery, safeContext);
      if (unsupportedPeriod) {
        return wrapIntent(unsupportedPeriod);
      }

      const priceChangeFollowUp = matchPriceChangeFollowUp(safeQuery, chain, safeContext, effectiveQuery);
      if (priceChangeFollowUp) {
        return wrapIntent(priceChangeFollowUp);
      }

      const priceChangeResult = matchPriceChangeQuery(effectiveQuery, chain);
      if (priceChangeResult) {
        return wrapIntent(priceChangeResult);
      }

      const convertResult = matchConvertQuery(effectiveQuery, chain, safeContext);
      if (convertResult) {
        return wrapIntent(convertResult);
      }

      const spotPriceResult = matchSpotPriceQuery(effectiveQuery, chain);
      if (spotPriceResult) {
        return wrapIntent(spotPriceResult);
      }

      const temporalFollowUp = matchTemporalFollowUp(safeQuery, chain, safeContext, effectiveQuery);
      if (temporalFollowUp) {
        return wrapIntent(temporalFollowUp);
      }

      const temporalResult = matchTemporalQuery(effectiveQuery, chain, safeContext);
      if (temporalResult) {
        return wrapIntent(temporalResult);
      }

      const templateResult = matchTemplate(effectiveQuery, chain);
      if (templateResult) {
        const forceConfirm = templateResult.action === "write";
        return wrapIntent(templateResult, forceConfirm);
      }

      const heuristicResult = inferIntentHeuristic(effectiveQuery, safeContext);
      if (heuristicResult) {
        return wrapIntent(heuristicResult, heuristicResult.action === "write");
      }

      if (llmConfig?.enabled && !isUnmappedMarketDurationFollowUp(safeQuery, effectiveQuery)) {
        const llmResult = await parseWithLlm(safeQuery, chain, llmConfig, safeContext, safeHistory, stream);
        if (llmResult) {
          validateLlmIntent(llmResult);
          return wrapIntent(sanitizeIntentForMcp(llmResult), llmResult.action === "write");
        }
      }

      throw new Error(buildParseFailedError(llmConfig));
    },

    explain(method: string, params: unknown[], chain: string) {
      if (method === "__list_chains__") return `Would list Pocket chains`;
      if (method === "__get_chain__") return `Would return chain metadata for ${chain}`;
      if (method === "__assistant_info__") return `Would return assistant and model information`;
      if (method === "__ens_balance__") return `Would resolve ENS ${params[0]} and fetch balance on eth`;
      if (method === "__native_convert__") return `Would convert native balance on ${chain}`;
      if (method === "__price_change_24h__") return `Would fetch 24h price change`;
      if (method === "__price_change__") return `Would fetch price change (${String(params[2] ?? "24h")})`;
      if (method === "__unsupported_market_period__") return `Would explain unsupported market period for ${params[1]}`;
      if (method === "__spot_price__") return `Would fetch spot price on ${chain}`;
      if (method === "__query_at_time__") return `Would look up historical value on ${chain}`;
      if (method === "__tx_history__") return `Would fetch recent transactions on ${chain}`;
      if (method === "__compare_gas__") return `Would compare gas prices across chains via Pocket RPC`;
      if (method === "__gas_fiat__") return `Would fetch gas price in fiat on ${chain}`;
      if (method === "__compare_balances__") return `Would compare native balances across EVM chains`;
      if (method === "__cosmos_balance__") return `Would fetch Cosmos bank balances via REST`;
      if (method === "__payment_from_me__") return `Would check if an address received funds from your wallet on ${chain}`;
      if (method === "__wallet_balances_multi__") return `Would fetch wallet balances across Pocket mainnets`;
      if (method === "__wallet_balances__") return `Would fetch wallet balances on ${chain}`;
      if (method === "__wallet_portfolio_convert__") return `Would convert wallet portfolio to target currency`;
      if (method === "__account_audit__") return `Would run multi-chain security audit for ${params[0]}`;
      if (method === "__wallet_health__") return `Would run wallet health check for ${params[0]}`;
      if (method === "__token_research__") return `Would research token on ${params[1]}`;
      if (method === "__explain_contract__") return `Would explain contract ${params[1]} on ${params[0]}`;
      if (method === "__governance__") return `Would query DAO governance`;
      if (method === "__scam_scan__") return `Would scan ${params[1]} for scam/rug risks on ${params[0]}`;
      if (method === "__defi_positions__") return `Would fetch DeFi positions for ${params[1]}`;
      if (method === "__operator_status__") return `Would fetch Pocket operator status`;
      if (method === "__token_send__") return `Would send ERC-20 tokens via connected wallet`;
      if (method === "__erc20_balance__") return `Would fetch ERC-20 balance on ${chain}`;
      if (method === "__transfer_events__") return `Would fetch ERC-20 Transfer event logs on ${chain}`;
      if (method === "__market_analytics_unsupported__") return `Would explain trading-volume ranking limits on ${chain}`;
      if (method === "__asset_trading_volume__") return `Would fetch CoinGecko trading volume for ${params[1]} over ${params[2]} day(s)`;
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
  if (intent.method === "__get_chain__") {
    const slug = (intent.params[0] as string) || intent.chain;
    return executeGetChain(slug);
  }
  if (intent.method === "__assistant_info__") {
    const topic = intent.params[0] as string | undefined;
    if (topic === "data_sources") {
      return { message: buildDataSourcesInfoMessage() };
    }
    if (topic === "greeting") {
      return { message: buildGreetingMessage() };
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
  if (intent.method === "__price_change__") {
    const [coingeckoId, symbol, period] = intent.params as [string, string, PriceChangePeriod?];
    return fetchPriceChange(coingeckoId, symbol, period ?? "24h");
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
    const [chain, symbol, walletAddress, blockRange, preferExplorer] = intent.params as [
      string,
      string,
      string,
      number,
      boolean?,
    ];
    return executeTransferEvents(
      pocket,
      chain,
      symbol,
      walletAddress,
      blockRange,
      preferExplorer === true,
    );
  }
  if (intent.method === "__market_analytics_unsupported__") {
    const [chainName] = intent.params as [string];
    return executeMarketAnalyticsUnsupported(chainName);
  }
  if (intent.method === "__asset_trading_volume__") {
    const [coingeckoId, symbol, days] = intent.params as [string, string, number];
    return fetchAssetTradingVolume(coingeckoId, symbol, days);
  }
  if (intent.method === "__unsupported_market_period__") {
    const [phrase, symbol] = intent.params as [string, string];
    return { message: formatUnsupportedMarketPeriodMessage(phrase, symbol) };
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
  if (intent.method === "__gas_fiat__") {
    const [chain, fiatVs, fiatSymbol] = intent.params as [string, string, string];
    return executeGasFiat(pocket, chain, fiatVs, fiatSymbol);
  }
  if (intent.method === "__compare_balances__") {
    const [address, chains] = intent.params as [string, string[]];
    return executeCompareBalances(pocket, address, chains);
  }
  if (intent.method === "__cosmos_balance__") {
    const [chain, address] = intent.params as [string, string];
    return fetchCosmosBalances(chain, address);
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
  if (intent.method === "__account_audit__") {
    const [address, options] = intent.params as [string, AccountAuditOptions?];
    return executeAccountAudit(pocket, address, options);
  }
  if (intent.method === "__wallet_health__") {
    const [address] = intent.params as [string];
    return executeWalletHealth(pocket, address);
  }
  if (intent.method === "__token_research__") {
    const [query, chain, tokenRef] = intent.params as [string, string, string];
    return executeTokenResearch(pocket, query, chain, tokenRef);
  }
  if (intent.method === "__explain_contract__") {
    const [chain, address] = intent.params as [string, string];
    return executeContractExplainer(pocket, chain, address);
  }
  if (intent.method === "__governance__") {
    const [query, space, mode] = intent.params as [string, string, import("./governance.js").GovernanceResult["mode"]];
    return executeGovernance(query, space, mode);
  }
  if (intent.method === "__scam_scan__") {
    const [chain, address] = intent.params as [string, string];
    return executeScamScan(pocket, chain, address);
  }
  if (intent.method === "__defi_positions__") {
    const [chain, address] = intent.params as [string, string];
    return executeDefiPositions(pocket, chain, address);
  }
  if (intent.method === "__operator_status__") {
    const [address, query] = intent.params as [string, string];
    return executeOperatorStatus(address, query);
  }
  if (intent.method === "__token_send__") {
    const txParams = intent.params[0] as import("./token-send.js").TokenSendTxParams;
    return {
      preview: true,
      ...txParams,
      summary: `Send ${txParams.tokenAmount} ${txParams.tokenSymbol} to ${txParams.recipient}`,
    };
  }
  const rpcParams =
    intent.method === "eth_call" ? normalizeEthCallParams(intent.params) : intent.params;
  validateRpcParams(intent.method, rpcParams);

  if (isTxLookupMethod(intent.method)) {
    const hash = typeof rpcParams[0] === "string" ? rpcParams[0] : undefined;
    if (hash) {
      const polled = await pollTxLookup(pocket, intent.chain, hash, intent.method);
      return enrichTxLookupOutput(intent.method, intent.chain, intent.params, polled);
    }
  }

  const resp = await pocket.rpc(intent.chain, intent.method, rpcParams);
  return enrichTxLookupOutput(intent.method, intent.chain, intent.params, {
    result: resp.result,
    meta: resp.meta,
  });
}

function normalizeEthCallParams(params: unknown[]): unknown[] {
  if (params.length === 0 || typeof params[0] !== "string") return params;
  const first = params[0];
  if (!first.startsWith("0x")) return params;

  const second = params[1];
  if (typeof second === "string" && second.startsWith("0x")) {
    const blockTag = params[2] ?? "latest";
    return [{ to: first, data: second }, blockTag];
  }

  if (params.length === 1) {
    return [{ to: first, data: "0x" }, "latest"];
  }

  return params;
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
  matchTemporalFollowUp,
  parseTimeOffsetSeconds,
  queryAtTime,
  type QueryAtTimeResult,
  type TemporalSubject,
} from "./temporal.js";
export {
  fetchPriceChange,
  fetchPriceChange24h,
  fetchSpotPrice,
  formatPriceChange,
  formatPriceChange24h,
  formatSpotPrice,
  formatUnsupportedMarketPeriodMessage,
  isPriceChangeQuery,
  isSpotPriceQuery,
  isUnmappedMarketDurationFollowUp,
  matchPriceChangeFollowUp,
  matchPriceChangeQuery,
  matchSpotPriceQuery,
  matchUnsupportedMarketPeriodQuery,
  parsePriceChangePeriod,
  type PriceChangePeriod,
  type PriceChangeResult,
  type PriceChange24hResult,
  type SpotPriceResult,
} from "./price.js";
export { expandFollowUpQuery, isVagueFollowUp, normalizeChatHistory } from "./context.js";
export {
  isTemporalFollowUp,
  isSwapStatusPhrase,
  isSendStatusPhrase,
  isVagueStatusFollowUp,
} from "./pattern-lib/follow-up-phrases.js";
export { parseMarketTimePeriod, marketPeriodLabel, type MarketTimePeriod } from "./pattern-lib/time-periods.js";
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
  executeCompareBalances,
  formatCompareBalances,
  isCompareBalancesQuery,
  matchCompareBalancesQuery,
  resolveCompareBalanceChains,
  type CompareBalanceEntry,
  type CompareBalancesResult,
} from "./compare-balances.js";
export {
  fetchCosmosBalances,
  formatCosmosBalances,
  isCosmosBalanceQuery,
  matchCosmosBalanceQuery,
  type CosmosBalance,
  type CosmosBalanceResult,
} from "./cosmos-balance.js";
export {
  executeAccountAudit,
  CHAT_ACCOUNT_AUDIT_OPTIONS,
  formatAccountAudit,
  isAccountAuditQuery,
  matchAccountAuditQuery,
  type AccountAuditOptions,
  type AccountAuditResult,
  type AuditFinding,
  type ChainAuditResult,
  type TokenApproval,
} from "./account-audit.js";
export {
  fetchPaymentFromMe,
  fetchTxHistory,
  fetchRecentTxsViaBlockScan,
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
  matchTransferEventFollowUp,
  wantsTransferEvents,
  type TransferEventEntry,
  type TransferEventsResult,
} from "./transfer-logs.js";
export {
  isContractCodeQuery,
  isSessionTxHashQuery,
  resolveChainFromSessionTx,
  wantsContractCode,
  wantsSend,
} from "./patterns.js";
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
  executeGasFiat,
  formatGasFiat,
  isGasFiatQuery,
  matchGasFiatQuery,
  type GasFiatResult,
} from "./gas-fiat.js";
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
  formatTxPendingMessage,
  isTxLookupMethod,
  pollTxLookup,
  wantsTxExplain,
  type TxNotFoundInfo,
} from "./tx-lookup.js";
export {
  executeMarketAnalyticsUnsupported,
  fetchAssetTradingVolume,
  formatAssetTradingVolume,
  formatMarketAnalyticsUnsupported,
  isMarketAnalyticsQuery,
  matchAssetTradingVolumeQuery,
  matchMarketAnalyticsQuery,
  type AssetTradingVolumeResult,
  type MarketAnalyticsUnsupportedResult,
} from "./market-analytics.js";
export {
  chainIdIntent,
  chainMetadataIntent,
  executeGetChain,
  formatGetChain,
  usesEvmChainIdRpc,
} from "./chain-metadata.js";
export {
  executeWalletHealth,
  formatWalletHealth,
  isWalletHealthQuery,
  matchWalletHealthQuery,
  type WalletHealthResult,
} from "./wallet-health.js";
export {
  executeTokenResearch,
  formatTokenResearch,
  isTokenResearchQuery,
  matchTokenResearchQuery,
  type TokenResearchResult,
} from "./token-research.js";
export {
  executeContractExplainer,
  formatContractExplainer,
  isContractExplainerQuery,
  matchContractExplainerQuery,
  type ContractExplainerResult,
} from "./contract-explainer.js";
export {
  executeGovernance,
  formatGovernance,
  isGovernanceQuery,
  matchGovernanceQuery,
  type GovernanceResult,
} from "./governance.js";
export {
  executeScamScan,
  formatScamScan,
  isScamScanQuery,
  matchScamScanQuery,
  type ScamScanResult,
} from "./scam-scan.js";
export {
  executeDefiPositions,
  formatDefiPositions,
  isDefiPositionsQuery,
  matchDefiPositionsQuery,
  type DefiPositionsResult,
} from "./defi-positions.js";
export {
  executeOperatorStatus,
  formatOperatorStatus,
  isOperatorStatusQuery,
  matchOperatorStatusQuery,
  type OperatorStatusHandlerResult,
} from "./operator-status.js";
export {
  isTokenSendQuery,
  matchTokenSendQuery,
  wantsTokenSend,
  formatTokenSendPreview,
  type TokenSendTxParams,
} from "./token-send.js";
