import { encodeFunctionData, getAddress } from "viem";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { inferChain, wantsMyWallet } from "./patterns.js";
import { KNOWN_TOKENS } from "./tokens.js";

const NATIVE_SEND_SYMBOLS = new Set(["ETH", "MATIC", "AVAX", "BNB", "BERA", "XDAI", "FTM", "NATIVE"]);

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export type TokenSendTxParams = {
  to: string;
  value: "0x0";
  data: string;
  tokenSymbol: string;
  tokenAmount: string;
  recipient: string;
};

export function wantsTokenSend(query: string): { amount: number; symbol: string; to: string } | null {
  const match = query.match(
    /(?:send|transfer|pay)\s+([\d.]+)\s+([a-zA-Z0-9]{2,12})\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
  );
  if (!match) return null;
  const symbol = match[2].toUpperCase();
  if (NATIVE_SEND_SYMBOLS.has(symbol)) return null;
  return { amount: parseFloat(match[1]), symbol, to: getAddress(match[3] as `0x${string}`) };
}

export function isTokenSendQuery(query: string): boolean {
  return wantsTokenSend(query) !== null;
}

export function encodeErc20TransferCalldata(recipient: string, amountRaw: bigint): string {
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient as `0x${string}`, amountRaw],
  });
}

function tokenAmountToRaw(amount: number, decimals: number): bigint {
  const factor = 10 ** decimals;
  const raw = Math.floor(amount * factor);
  if (!Number.isFinite(amount) || amount <= 0 || raw <= 0) {
    throw new Error("NL_PARSE_FAILED: send amount must be positive");
  }
  return BigInt(raw);
}

export function matchTokenSendQuery(query: string, context?: SessionContext): RpcIntent | null {
  const parsed = wantsTokenSend(query);
  if (!parsed) return null;

  const from = context?.connectedAddress;
  if (!from) {
    throw new Error("WALLET_NOT_CONNECTED: Connect your wallet to send tokens.");
  }

  const chain = inferChain(query, context);
  const token = KNOWN_TOKENS[chain]?.[parsed.symbol];
  if (!token) {
    const supported = Object.keys(KNOWN_TOKENS[chain] ?? {}).join(", ") || "none on this chain";
    throw new Error(`NL_PARSE_FAILED: unknown token ${parsed.symbol} on ${chain}. Supported: ${supported}`);
  }

  const amountRaw = tokenAmountToRaw(parsed.amount, token.decimals);
  const data = encodeErc20TransferCalldata(parsed.to, amountRaw);
  const txParams: TokenSendTxParams = {
    to: token.address,
    value: "0x0",
    data,
    tokenSymbol: parsed.symbol,
    tokenAmount: String(parsed.amount),
    recipient: parsed.to,
  };

  return {
    action: "write",
    chain,
    method: "__token_send__",
    params: [txParams],
    humanSummary: `Send ${parsed.amount} ${parsed.symbol} to ${parsed.to} on ${chain}`,
    riskLevel: "high",
  };
}

export function formatTokenSendPreview(params: TokenSendTxParams): string {
  return `Send ${params.tokenAmount} ${params.tokenSymbol} to ${params.recipient}`;
}
