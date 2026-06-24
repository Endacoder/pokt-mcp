/** ~12.5% headroom on eth_estimateGas / route limits — avoids OOG without large overpay. */
const GAS_BUFFER_NUMERATOR = 1125n;
const GAS_BUFFER_DENOMINATOR = 1000n;
const MIN_GAS_LIMIT = 21_000n;

/** Default when eth_estimateGas reverts and no route gas is provided (typical swap range). */
export const CONTRACT_CALL_GAS_FALLBACK = 350_000n;

export function applyGasSafetyBuffer(gas: bigint): bigint {
  if (gas <= 0n) return MIN_GAS_LIMIT;
  const buffered = (gas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
  return buffered > MIN_GAS_LIMIT ? buffered : MIN_GAS_LIMIT;
}

export function applyGasSafetyBufferHex(gas: string | number | bigint): string {
  const raw =
    typeof gas === "bigint"
      ? gas
      : typeof gas === "number"
        ? BigInt(Math.trunc(gas))
        : BigInt(gas.startsWith("0x") ? gas : gas.trim());
  return `0x${applyGasSafetyBuffer(raw).toString(16)}`;
}
