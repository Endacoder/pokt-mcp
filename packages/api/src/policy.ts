import type { UnsignedTransaction } from "@pokt-mcp/shared";
import {
  parseAllowedChains,
  parseMethodDenylist,
  DEFAULT_MAX_SEND_VALUE_ETH,
} from "@pokt-mcp/shared";

export interface PolicyConfig {
  maxSendValueEth: number;
  allowedChains: Set<string>;
  methodDenylist: Set<string>;
  requireConfirmation: boolean;
}

export function loadPolicyConfig(): PolicyConfig {
  const allowed = parseAllowedChains();
  return {
    maxSendValueEth: parseFloat(process.env.MAX_SEND_VALUE_ETH ?? String(DEFAULT_MAX_SEND_VALUE_ETH)),
    allowedChains: new Set(allowed),
    methodDenylist: new Set(parseMethodDenylist()),
    requireConfirmation: process.env.REQUIRE_CONFIRMATION !== "false",
  };
}

export function assertWritePolicy(
  config: PolicyConfig,
  tx: Pick<UnsignedTransaction, "chain" | "value">,
): void {
  if (!config.allowedChains.has(tx.chain)) {
    throw new Error(`POLICY_DENIED: chain "${tx.chain}" not allowed`);
  }
  if (tx.value) {
    const wei = BigInt(tx.value);
    const maxWei = BigInt(Math.floor(config.maxSendValueEth * 1e18));
    if (wei > maxWei) {
      throw new Error(`POLICY_DENIED: value exceeds MAX_SEND_VALUE_ETH (${config.maxSendValueEth})`);
    }
  }
}

export function assertMethodAllowed(config: PolicyConfig, method: string): void {
  if (config.methodDenylist.has(method)) {
    throw new Error(`POLICY_DENIED: method "${method}" is not allowed`);
  }
}
