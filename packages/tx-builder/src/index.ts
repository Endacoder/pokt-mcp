import { createPocketClient, resolveChain } from "@pokt-mcp/pocket-client";
import { applyGasSafetyBufferHex, CONTRACT_CALL_GAS_FALLBACK } from "@pokt-mcp/shared";
import type { UnsignedTransaction } from "@pokt-mcp/shared";
import { encodeFunctionData, getAddress, parseEther, type Abi } from "viem";

export interface BuildTransferInput {
  chain: string;
  from: string;
  to: string;
  value: string;
  data?: string;
  /** Used when eth_estimateGas reverts (common for swap router calldata). */
  gasLimit?: string;
}

export function checksumAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return getAddress(trimmed.toLowerCase() as `0x${string}`);
}

export function parseValueToHex(value: string): string {
  if (value.startsWith("0x")) return value;
  return `0x${parseEther(value).toString(16)}`;
}

/** Normalize RPC quantity to hex (Uniswap API often returns decimal gas limits). */
export function normalizeGasQuantity(gas: string | number | bigint | undefined): string | undefined {
  if (gas == null) return undefined;
  if (typeof gas === "bigint") return `0x${gas.toString(16)}`;
  if (typeof gas === "number") {
    if (!Number.isFinite(gas) || gas <= 0) return undefined;
    return `0x${Math.trunc(gas).toString(16)}`;
  }
  const trimmed = gas.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("0x")) return trimmed;
  try {
    return `0x${BigInt(trimmed).toString(16)}`;
  } catch {
    return undefined;
  }
}

export interface BuildTransactionFeesInput {
  chain: string;
  from: string;
}

/** Nonce + EIP-1559 fees without eth_estimateGas (for swap calldata that reverts in simulation). */
export async function buildTransactionFeesOnly(
  input: BuildTransactionFeesInput,
): Promise<Pick<UnsignedTransaction, "from" | "nonce" | "maxFeePerGas" | "maxPriorityFeePerGas" | "chainId" | "chain">> {
  const pocket = createPocketClient();
  const chainInfo = resolveChain(input.chain);
  if (!chainInfo?.chainId) {
    throw new Error(`CHAIN_NOT_FOUND: ${input.chain}`);
  }

  const from = checksumAddress(input.from);

  const [nonceResp, feeResp] = await Promise.all([
    pocket.rpc<string>(chainInfo.slug, "eth_getTransactionCount", [from, "latest"]),
    pocket.rpc<string>(chainInfo.slug, "eth_maxPriorityFeePerGas", []),
  ]);

  const maxPriorityFeePerGas = feeResp.result;
  const baseFeeResp = await pocket.rpc<string>(chainInfo.slug, "eth_getBlockByNumber", ["latest", false]);
  const baseFee = (baseFeeResp.result as { baseFeePerGas?: string })?.baseFeePerGas ?? "0x0";
  const maxFeePerGas = `0x${(BigInt(baseFee) * 2n + BigInt(maxPriorityFeePerGas)).toString(16)}`;

  return {
    chain: chainInfo.slug,
    from,
    nonce: parseInt(nonceResp.result, 16),
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: chainInfo.chainId,
  };
}

export async function buildTransfer(input: BuildTransferInput): Promise<UnsignedTransaction> {
  const pocket = createPocketClient();
  const chainInfo = resolveChain(input.chain);
  if (!chainInfo?.chainId) {
    throw new Error(`CHAIN_NOT_FOUND: ${input.chain}`);
  }

  const from = checksumAddress(input.from);
  const to = checksumAddress(input.to);
  const value = parseValueToHex(input.value);
  const data = input.data ?? "0x";

  const [nonceResp, feeResp] = await Promise.all([
    pocket.rpc<string>(chainInfo.slug, "eth_getTransactionCount", [from, "latest"]),
    pocket.rpc<string>(chainInfo.slug, "eth_maxPriorityFeePerGas", []),
  ]);

  let gas: string;
  try {
    const gasResp = await pocket.rpc<string>(chainInfo.slug, "eth_estimateGas", [{ from, to, value, data }]);
    gas = applyGasSafetyBufferHex(gasResp.result);
  } catch (rpcErr) {
    if (input.gasLimit) {
      const hint = normalizeGasQuantity(input.gasLimit);
      gas = hint ? applyGasSafetyBufferHex(hint) : applyGasSafetyBufferHex(CONTRACT_CALL_GAS_FALLBACK);
    } else if (data !== "0x") {
      gas = applyGasSafetyBufferHex(CONTRACT_CALL_GAS_FALLBACK);
    } else {
      throw rpcErr;
    }
  }

  const maxPriorityFeePerGas = feeResp.result;
  const baseFeeResp = await pocket.rpc<string>(chainInfo.slug, "eth_getBlockByNumber", ["latest", false]);
  const baseFee = (baseFeeResp.result as { baseFeePerGas?: string })?.baseFeePerGas ?? "0x0";
  const maxFeePerGas = `0x${(BigInt(baseFee) * 2n + BigInt(maxPriorityFeePerGas)).toString(16)}`;

  return {
    chain: chainInfo.slug,
    from,
    to,
    value,
    data,
    nonce: parseInt(nonceResp.result, 16),
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: chainInfo.chainId,
  };
}

export function encodeContractCall(abi: Abi, functionName: string, args: unknown[]): string {
  return encodeFunctionData({ abi, functionName, args });
}
