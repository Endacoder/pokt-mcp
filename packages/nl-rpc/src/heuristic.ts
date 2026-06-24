import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import {
  extractAddress,
  extractBlockNumber,
  extractTxHash,
  inferChain,
  intent,
  resolveAddress,
  wantsBalance,
  wantsChainId,
  wantsContractCode,
  wantsGasPrice,
  wantsLatestBlock,
  wantsListChains,
  wantsNetVersion,
  wantsNonce,
  wantsReceipt,
  wantsSend,
  wantsSyncing,
  wantsTxLookup,
} from "./patterns.js";
import { chainIdIntent } from "./chain-metadata.js";
import { wantsGasAssessment } from "./gas-assessment.js";

/**
 * Logic-based fallback: infer RPC intents from keywords and extracted entities.
 * Runs after explicit templates when no exact template matched.
 */
export function inferIntentHeuristic(query: string, context?: SessionContext): RpcIntent | null {
  const chain = inferChain(query, context);
  const address = resolveAddress(query, context);

  if (wantsListChains(query)) {
    return intent(chain, "__list_chains__", [], "List available Pocket chains");
  }

  if (wantsSend(query)) {
    const send = wantsSend(query)!;
    const valueWei = `0x${BigInt(Math.floor(send.amount * 1e18)).toString(16)}`;
    return intent(
      chain,
      "eth_sendTransaction",
      [{ to: send.to, value: valueWei }],
      `Send ${send.amount} native tokens to ${send.to} on ${chain}`,
      "write",
      "high",
    );
  }

  const blockNum = extractBlockNumber(query);
  if (blockNum) {
    return intent(
      chain,
      "eth_getBlockByNumber",
      [`0x${Number(blockNum).toString(16)}`, false],
      `Get block ${blockNum} on ${chain}`,
    );
  }

  if (wantsLatestBlock(query)) {
    return intent(chain, "eth_blockNumber", [], `Get latest block number on ${chain}`);
  }

  if (wantsGasPrice(query) || wantsGasAssessment(query)) {
    return intent(chain, "eth_gasPrice", [], `Get current gas price on ${chain}`);
  }

  if (wantsBalance(query) && address) {
    if (address.endsWith(".eth")) {
      return intent("eth", "__ens_balance__", [address], `Resolve ENS and get balance for ${address}`);
    }
    return intent(
      chain,
      "eth_getBalance",
      [address, "latest"],
      `Get native balance for ${address} on ${chain}`,
    );
  }

  if (wantsNonce(query) && address) {
    return intent(
      chain,
      "eth_getTransactionCount",
      [address, "latest"],
      `Get transaction count (nonce) for ${address} on ${chain}`,
    );
  }

  if (wantsReceipt(query)) {
    const hash = extractTxHash(query)!;
    return intent(
      chain,
      "eth_getTransactionReceipt",
      [hash],
      `Get receipt for ${hash}`,
    );
  }

  if (wantsTxLookup(query)) {
    const hash = extractTxHash(query)!;
    return intent(chain, "eth_getTransactionByHash", [hash], `Get transaction ${hash} on ${chain}`);
  }

  if (wantsContractCode(query)) {
    const addr = extractAddress(query)!;
    return intent(chain, "eth_getCode", [addr, "latest"], `Get contract code at ${addr} on ${chain}`);
  }

  if (wantsChainId(query)) {
    return chainIdIntent(chain);
  }

  if (wantsNetVersion(query)) {
    return intent(chain, "net_version", [], `Get network version for ${chain}`);
  }

  if (wantsSyncing(query)) {
    return intent(chain, "eth_syncing", [], `Get sync status on ${chain}`);
  }

  // Bare address lookup → balance on default chain
  const bareAddr = extractAddress(query);
  if (bareAddr && !bareAddr.endsWith(".eth") && query.trim().length < 50) {
    return intent(
      chain,
      "eth_getBalance",
      [bareAddr, "latest"],
      `Get native balance for ${bareAddr} on ${chain}`,
    );
  }

  return null;
}
