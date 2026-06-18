import type { UnsignedTransaction } from "@pokt-mcp/shared";

const DEFAULT_DENYLIST = ["personal_importRawKey", "eth_sign"];

export interface PolicyConfig {
  maxSendValueEth: number;
  allowedChains: Set<string>;
  methodDenylist: Set<string>;
  requireConfirmation: boolean;
}

export function loadPolicyConfig(): PolicyConfig {
  const envDeny = (process.env.RPC_METHOD_DENYLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = (process.env.WALLET_ALLOWED_CHAINS ?? "eth,base,poly,arb-one,opt,avax")
    .split(",")
    .map((s) => s.trim());
  return {
    maxSendValueEth: parseFloat(process.env.MAX_SEND_VALUE_ETH ?? "1.0"),
    allowedChains: new Set(allowed),
    methodDenylist: new Set([...DEFAULT_DENYLIST, ...envDeny]),
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
