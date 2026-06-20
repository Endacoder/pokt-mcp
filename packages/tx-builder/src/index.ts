import { createPocketClient, resolveChain } from "@pokt-mcp/pocket-client";
import type { UnsignedTransaction } from "@pokt-mcp/shared";
import { encodeFunctionData, getAddress, isAddress, parseEther, type Abi } from "viem";

export interface BuildTransferInput {
  chain: string;
  from: string;
  to: string;
  value: string;
  data?: string;
}

export function checksumAddress(address: string): string {
  if (!isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return getAddress(address);
}

export function parseValueToHex(value: string): string {
  if (value.startsWith("0x")) return value;
  return `0x${parseEther(value).toString(16)}`;
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

  const [nonceResp, gasResp, feeResp] = await Promise.all([
    pocket.rpc<string>(chainInfo.slug, "eth_getTransactionCount", [from, "latest"]),
    pocket.rpc<string>(chainInfo.slug, "eth_estimateGas", [{ from, to, value, data }]),
    pocket.rpc<string>(chainInfo.slug, "eth_maxPriorityFeePerGas", []),
  ]);

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
    gas: gasResp.result,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: chainInfo.chainId,
  };
}

export function encodeContractCall(abi: Abi, functionName: string, args: unknown[]): string {
  return encodeFunctionData({ abi, functionName, args });
}
