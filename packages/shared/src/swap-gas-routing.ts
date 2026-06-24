/** Hints from an Intent MCP quote or UI display used to detect user-paid gas routes. */
export type GasRouteHint = {
  executionMode?: string;
  route?: string;
  routeType?: string;
  gasless?: boolean;
  gasEstimateUsd?: number;
};

/** Providers that require the user to pay network gas (Intent MCP prepare_intent ack). */
const USER_PAID_GAS_ROUTE_RE =
  /\b(LI\.FI|CLASSIC|UNISWAP\s+V[0-9]|ERC7683|BRIDGE)\b/i;

/**
 * True when Intent MCP expects `acknowledgeUserPaidGas: true` before prepare_intent.
 * Best-price (`executionMode: "any"`) quotes can still route via Uniswap CLASSIC or LI.FI.
 */
export function isUserPaidGasRoute(hint: GasRouteHint): boolean {
  if (hint.executionMode === "gasless" || hint.gasless === true) return false;
  if (hint.executionMode === "gas" || hint.gasless === false) return true;

  const routeText = `${hint.route ?? ""} ${hint.routeType ?? ""}`.trim();
  if (routeText && USER_PAID_GAS_ROUTE_RE.test(routeText)) return true;

  if (hint.gasEstimateUsd != null && hint.gasEstimateUsd > 0) return true;

  return false;
}

export function quoteRequiresGasAck(hint?: GasRouteHint): boolean {
  return hint ? isUserPaidGasRoute(hint) : false;
}

/** Intent MCP / API errors when a gas route was prepared without user gas acknowledgement. */
export function isUserPaidGasRequiredError(message: string): boolean {
  return (
    /USER_PAID_GAS_REQUIRED/i.test(message) ||
    /requires user-paid network gas/i.test(message) ||
    /only accepts gasless quotes/i.test(message)
  );
}
