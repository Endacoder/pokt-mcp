import type { ChainProtocol } from "@pokt-mcp/shared";

export const EVM_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_feeHistory",
  "eth_sendRawTransaction",
] as const;

export const SOLANA_METHODS = [
  "getBalance",
  "getAccountInfo",
  "getTransaction",
  "getLatestBlockhash",
  "sendTransaction",
] as const;

export const COSMOS_METHODS = ["status", "block", "tx"] as const;

export const SUI_METHODS = ["sui_getBalance", "sui_getObject", "sui_getTransactionBlock"] as const;
export const NEAR_METHODS = ["query", "block", "tx"] as const;
export const TRON_METHODS = ["eth_chainId", "eth_getBalance", "eth_blockNumber"] as const;

export function listMethodsForProtocol(protocol: ChainProtocol): readonly string[] {
  switch (protocol) {
    case "evm":
      return EVM_METHODS;
    case "solana":
      return SOLANA_METHODS;
    case "cosmos":
      return COSMOS_METHODS;
    case "sui":
      return SUI_METHODS;
    case "near":
      return NEAR_METHODS;
    case "tron":
      return TRON_METHODS;
    default:
      return EVM_METHODS;
  }
}
