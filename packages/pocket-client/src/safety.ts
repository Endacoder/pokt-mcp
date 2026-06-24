export const MAX_BLOCK_RANGE = 10_000;
export const MAX_COMPARE_CHAINS = 5;
export const MAX_RESPONSE_SIZE = 50_000;

export const DANGEROUS_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_sendTransaction",
  "wallet_signTransaction",
] as const;

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface SafetyCheckedResponse<T = unknown> {
  result: T;
  truncated: boolean;
  warning?: string;
}

function isHexBlock(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("0x") && value !== "latest";
}

export function preCheckRpc(method: string, params: unknown[] = []): SafetyCheckResult {
  if ((DANGEROUS_METHODS as readonly string[]).includes(method)) {
    return { allowed: false, reason: `Method '${method}' is blocked for safety reasons.` };
  }

  if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") {
    if (params[1] === true) {
      return {
        allowed: false,
        reason: "Full transaction objects in block responses are not permitted (fullTx must be false).",
      };
    }
  }

  if (method === "eth_getLogs") {
    const filter = params[0];
    if (filter == null || typeof filter !== "object") {
      return { allowed: false, reason: "eth_getLogs requires a filter object as the first parameter." };
    }

    const f = filter as Record<string, unknown>;
    if (f.address == null && f.topics == null) {
      return {
        allowed: false,
        reason: "eth_getLogs filter must specify at least one of: address, topics.",
      };
    }

    const fromRaw = f.fromBlock;
    const toRaw = f.toBlock;
    if (isHexBlock(fromRaw) && isHexBlock(toRaw) && toRaw !== "latest") {
      const from = parseInt(fromRaw, 16);
      const to = parseInt(toRaw, 16);
      if (!Number.isNaN(from) && !Number.isNaN(to)) {
        const range = to - from;
        if (range > MAX_BLOCK_RANGE) {
          return {
            allowed: false,
            reason: `eth_getLogs block range ${range} exceeds the maximum of ${MAX_BLOCK_RANGE}.`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

export function postCheckResponse<T>(result: T): SafetyCheckedResponse<T> {
  const serialised = JSON.stringify(result);
  if (serialised.length <= MAX_RESPONSE_SIZE) {
    return { result, truncated: false };
  }

  const truncateAt = Math.floor(MAX_RESPONSE_SIZE * 0.8);
  return {
    result: {
      warning: `Response truncated: original size ${serialised.length} bytes exceeded the ${MAX_RESPONSE_SIZE}-byte limit.`,
      partial: serialised.slice(0, truncateAt),
    } as T,
    truncated: true,
    warning: `Response truncated at ${MAX_RESPONSE_SIZE} bytes`,
  };
}

export function assertCompareChainCount(count: number): void {
  if (count > MAX_COMPARE_CHAINS) {
    throw new Error(
      `POLICY_DENIED: compare_balances accepts at most ${MAX_COMPARE_CHAINS} chains; ${count} provided.`,
    );
  }
}
