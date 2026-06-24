import type { SessionContext } from "@pokt-mcp/shared";
import { matchConvertQuery } from "./convert.js";
import { inferIntentHeuristic } from "./heuristic.js";
import { matchMetaQuery } from "./meta.js";
import { matchSpotPriceQuery } from "./price.js";
import { matchTemporalQuery } from "./temporal.js";
import { inferChain, matchTemplate } from "./templates/index.js";
import { isWalletBalanceQuery } from "./wallet-balance.js";
import { isCompareGasQuery } from "./compare-gas.js";
import { isGasFiatQuery } from "./gas-fiat.js";
import { isCompareBalancesQuery } from "./compare-balances.js";
import { isCosmosBalanceQuery } from "./cosmos-balance.js";
import { isPaymentFromMeQuery, isTxHistoryQuery } from "./tx-history.js";
import { isContractCodeQuery } from "./patterns.js";
import { isTransferEventQuery } from "./transfer-logs.js";
import { isMarketAnalyticsQuery } from "./market-analytics.js";

/** True when query has no template/heuristic fast-path match (needs LLM or agent). */
export function needsDynamicRouting(query: string, context?: SessionContext): boolean {
  if (matchMetaQuery(query)) return false;
  if (isWalletBalanceQuery(query)) return false;
  if (isTxHistoryQuery(query)) return false;
  if (isPaymentFromMeQuery(query)) return false;
  if (isCompareGasQuery(query)) return false;
  if (isGasFiatQuery(query)) return false;
  if (isCompareBalancesQuery(query)) return false;
  if (isCosmosBalanceQuery(query)) return false;
  if (isMarketAnalyticsQuery(query)) return false;

  const chain = inferChain(query, context);
  if (isContractCodeQuery(query)) return false;
  if (isTransferEventQuery(query)) return false;
  if (matchConvertQuery(query, chain, context)) return false;
  if (matchSpotPriceQuery(query, chain)) return false;
  if (matchTemporalQuery(query, chain, context)) return false;
  if (matchTemplate(query, chain)) return false;
  if (inferIntentHeuristic(query, context)) return false;

  return true;
}
