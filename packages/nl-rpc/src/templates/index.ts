import type { RpcIntent } from "../types.js";

type TemplateMatcher = (query: string, chain: string) => RpcIntent | null;

const templates: TemplateMatcher[] = [
  (query, chain) => {
    if (!/gas price|current gas/.test(query.toLowerCase())) return null;
    return {
      action: "read",
      chain,
      method: "eth_gasPrice",
      params: [],
      humanSummary: `Get current gas price on ${chain}`,
      riskLevel: "none",
    };
  },
  (query, chain) => {
    const txMatch = query.match(/transaction\s+(0x[a-fA-F0-9]{64})/i);
    if (!txMatch) return null;
    return {
      action: "read",
      chain,
      method: "eth_getTransactionByHash",
      params: [txMatch[1]],
      humanSummary: `Get transaction ${txMatch[1]} on ${chain}`,
      riskLevel: "none",
    };
  },
  (query, chain) => {
    if (!/chain id/.test(query.toLowerCase())) return null;
    return {
      action: "read",
      chain,
      method: "eth_chainId",
      params: [],
      humanSummary: `Get chain ID for ${chain}`,
      riskLevel: "none",
    };
  },
  (query, chain) => {
    const receiptMatch = query.match(/receipt\s+(0x[a-fA-F0-9]{64})/i);
    if (!receiptMatch) return null;
    return {
      action: "read",
      chain,
      method: "eth_getTransactionReceipt",
      params: [receiptMatch[1]],
      humanSummary: `Get receipt for ${receiptMatch[1]}`,
      riskLevel: "none",
    };
  },
];

export function matchTemplate(query: string, chain: string): RpcIntent | null {
  for (const template of templates) {
    const result = template(query, chain);
    if (result) return result;
  }
  return null;
}

export function listTemplateNames(): string[] {
  return [
    "gas_price",
    "transaction_lookup",
    "chain_id",
    "receipt_lookup",
    "balance",
    "block_number",
    "block_by_number",
    "send",
    "ens_balance",
    "list_chains",
  ];
}
