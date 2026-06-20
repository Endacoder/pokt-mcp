import type { RpcIntent } from "@pokt-mcp/shared";
import { matchErc20BalanceQuery } from "../erc20-balance.js";
import {
  extractAddress,
  extractSolanaAddress,
  extractBlockNumber,
  extractTxHash,
  inferChain,
  intent,
  wantsListChains,
  wantsLatestBlock,
  wantsLatestSlot,
  wantsGasPrice,
  wantsSolanaBalance,
  wantsBalance,
  wantsChainId,
  wantsSend,
} from "../patterns.js";

type TemplateMatcher = (query: string, chain: string) => RpcIntent | null;

const templates: TemplateMatcher[] = [
  (query, chain) => {
    if (!wantsListChains(query)) return null;
    return intent(chain, "__list_chains__", [], "List available Pocket chains");
  },
  (query, chain) => {
    if (!wantsLatestBlock(query)) return null;
    return intent(chain, "eth_blockNumber", [], `Get latest block number on ${chain}`);
  },
  (query, chain) => {
    const blockNum = extractBlockNumber(query);
    if (!blockNum) return null;
    return intent(
      chain,
      "eth_getBlockByNumber",
      [`0x${Number(blockNum).toString(16)}`, false],
      `Get block ${blockNum} on ${chain}`,
    );
  },
  (query, chain) => matchErc20BalanceQuery(query, { defaultChain: chain }),
  (query) => {
    if (!wantsLatestSlot(query)) return null;
    return intent("solana", "__solana_slot__", [], "Get latest slot on Solana");
  },
  (query) => {
    if (!wantsSolanaBalance(query)) return null;
    const addr = extractSolanaAddress(query);
    if (!addr) return null;
    return intent("solana", "__solana_balance__", [addr], `Get SOL balance for ${addr}`);
  },  (query, chain) => {
    if (!wantsBalance(query)) return null;
    const addr = extractAddress(query);
    if (!addr) return null;
    if (addr.endsWith(".eth")) {
      return intent("eth", "__ens_balance__", [addr], `Resolve ENS and get balance for ${addr}`);
    }
    return intent(
      chain,
      "eth_getBalance",
      [addr, "latest"],
      `Get native balance for ${addr} on ${chain}`,
    );
  },
  (query, chain) => {
    if (!wantsGasPrice(query)) return null;
    return intent(chain, "eth_gasPrice", [], `Get current gas price on ${chain}`);
  },
  (query, chain) => {
    const txMatch = query.match(/transaction\s+(0x[a-fA-F0-9]{64})/i);
    if (txMatch) {
      return intent(chain, "eth_getTransactionByHash", [txMatch[1]], `Get transaction ${txMatch[1]}`);
    }
    const hash = extractTxHash(query);
    if (hash && /\b(tx|transaction|hash)\b/i.test(query)) {
      return intent(chain, "eth_getTransactionByHash", [hash], "Get transaction details");
    }
    return null;
  },
  (query, chain) => {
    if (!wantsChainId(query)) return null;
    return intent(chain, "eth_chainId", [], `Get chain ID for ${chain}`);
  },
  (query, chain) => {
    const receiptMatch = query.match(/receipt\s+(0x[a-fA-F0-9]{64})/i);
    if (!receiptMatch) return null;
    return intent(
      chain,
      "eth_getTransactionReceipt",
      [receiptMatch[1]],
      `Get receipt for ${receiptMatch[1]}`,
    );
  },
  (query, chain) => {
    const send = wantsSend(query);
    if (!send) return null;
    const valueWei = `0x${BigInt(Math.floor(send.amount * 1e18)).toString(16)}`;
    return intent(
      chain,
      "eth_sendTransaction",
      [{ to: send.to, value: valueWei }],
      `Send ${send.amount} native tokens to ${send.to} on ${chain}`,
      "write",
      "high",
    );
  },
];

export function matchTemplate(query: string, chain: string): RpcIntent | null {
  for (const template of templates) {
    const result = template(query, chain);
    if (result) return result;
  }
  return null;
}

export { inferChain };

export function listTemplateNames(): string[] {
  return [
    "list_chains",
    "block_number",
    "block_by_number",
    "balance",
    "gas_price",
    "transaction_lookup",
    "chain_id",
    "receipt_lookup",
    "send",
    "ens_balance",
    "erc20_balance",
    "solana_slot",
    "solana_balance",
  ];
}
