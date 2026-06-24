import { isMetaQuery, isPriceChangeQuery, isSpotPriceQuery, isTokenQuoteQuery, isTokenSendQuery, isTxHistoryQuery, isPaymentFromMeQuery, isCompareGasQuery, isGasFiatQuery, isWalletBalanceQuery, isContractCodeQuery, isTransferEventQuery, isMarketAnalyticsQuery } from "@pokt-mcp/nl-rpc";
import { isSwapStatusQuery } from "./intent-swap-status.js";
import { isSendStatusQuery } from "./send-status.js";

function normalizeSwapQueryText(query: string): string {
  let q = query.trim();
  q = q.replace(/\b(swap|trade|exchange)(\d)/gi, "$1 $2");
  q = q.replace(/\b(?:to|for|into)\s+wth\b/gi, (match) => match.replace(/wth/i, "weth"));
  return q;
}
export function isComplexQuery(message: string): boolean {
  const q = message.toLowerCase();
  const signals = [
    /\btransfer(s)?\b/,
    /\blogs?\b/,
    /\bevents?\b/,
    /\bcompare\b/,
    /\bhistory\b/,
    /\blargest\b/,
    /\ball transactions\b/,
    /\brecent\b/,
    /\btoken\b/,
    /\bcall contract\b/,
    /\berc-?20\b/,
    /\busdc\b/,
    /\busdt\b/,
    /\bdai\b/,
    /\bholders?\b/,
    /\bactivity\b/,
    /\bcontract\b/,
    /\bcode at\b/,
    /\bbytecode\b/,
    /\bvalidators?\b/,
    /\bsupply\b/,
    /\bnft\b/,
    /\bdefi\b/,
    /\bswap\b/,
    /\bpool\b/,
    /\bwhat is\b/,
    /\bshow me\b/,
    /\bfind\b/,
    /\blookup\b/,
  ];
  if (signals.some((s) => s.test(q))) return true;
  if ((q.match(/\band\b/g) ?? []).length >= 2) return true;
  return false;
}

export function isParseFailedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("NL_PARSE_FAILED");
}

export function isExecutionFailedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("NL_PARSE_FAILED") ||
    message.includes("RPC_ERROR") ||
    message.includes("POLICY_DENIED") ||
    message.includes("CHAIN_NOT_FOUND") ||
    message.includes("requires") && message.includes("param")
  );
}

export function isSwapQuery(message: string): boolean {
  if (isTokenQuoteQuery(message)) return false;
  if (isSwapStatusQuery(message)) return false;
  if (isMarketAnalyticsQuery(message)) return false;
  const q = normalizeSwapQueryText(message).toLowerCase();

  if (/\b(trading\s+volume|trade\s+volume|volume\s+of\s+trade|trading\s+activity)\b/.test(q)) {
    return false;
  }
  if (/\bvolume\b/.test(q) && /\b(?:last|past|over|in)\s+\d+\s+days?\b/.test(q)) {
    return false;
  }

  if (/\bswap\b/.test(q) || /\bswap\s*[\d.,]/.test(q)) return true;
  if (/\b(?:trade|exchange)\s+[\d.,]+\s+\w+\s+(?:for|to|into)\b/.test(q)) return true;
  if (/\b(?:trade|exchange)\s+(?:my\s+)?\w+\s+(?:for|to|into)\s+\w+/.test(q)) return true;
  return false;
}

export function shouldUseAgentFirst(
  query: string,
  needsDynamicRouting: boolean,
): boolean {
  if (isPriceChangeQuery(query)) return false;
  if (isMetaQuery(query)) return false;
  if (isTokenQuoteQuery(query)) return false;
  if (isWalletBalanceQuery(query)) return false;
  if (isTxHistoryQuery(query)) return false;
  if (isPaymentFromMeQuery(query)) return false;
  if (isCompareGasQuery(query)) return false;
  if (isGasFiatQuery(query)) return false;
  if (isSpotPriceQuery(query)) return false;
  if (isContractCodeQuery(query)) return false;
  if (isTransferEventQuery(query)) return false;
  if (isMarketAnalyticsQuery(query)) return false;
  if (isSwapStatusQuery(query)) return false;
  if (isSendStatusQuery(query)) return false;
  if (isTokenSendQuery(query)) return false;
  if (isSwapQuery(query)) return false;
  return isComplexQuery(query) || needsDynamicRouting;
}
