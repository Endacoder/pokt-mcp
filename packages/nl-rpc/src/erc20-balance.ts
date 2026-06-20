import { resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { extractAddress, inferChain, intent, wantsBalance } from "./patterns.js";
import { KNOWN_TOKENS } from "./tokens.js";

const BALANCE_OF_SELECTOR = "0x70a08231";
const TOKEN_SYMBOL_PATTERN = /\b(USDC|USDT|DAI|WETH|WBTC|LINK|UNI|AAVE)\b/i;

export function extractErc20TokenSymbol(query: string): string | null {
  const match = query.match(TOKEN_SYMBOL_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function matchErc20BalanceQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!wantsBalance(query)) return null;
  const symbol = extractErc20TokenSymbol(query);
  if (!symbol) return null;
  const address = extractAddress(query);
  if (!address || address.endsWith(".eth")) return null;

  const chain = inferChain(query, context);
  if (!KNOWN_TOKENS[chain]?.[symbol]) return null;

  return intent(
    chain,
    "__erc20_balance__",
    [chain, symbol, address],
    `Get ${symbol} balance for ${address} on ${chain}`,
  );
}

export type Erc20BalanceResult = {
  chain: string;
  symbol: string;
  address: string;
  tokenAddress: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
};

function padAddress(address: string): string {
  return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function encodeBalanceOfCalldata(holder: string): string {
  return `${BALANCE_OF_SELECTOR}${padAddress(holder)}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export async function executeErc20Balance(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  symbol: string,
  address: string,
): Promise<Erc20BalanceResult> {
  const tokenInfo = KNOWN_TOKENS[chain]?.[symbol];
  if (!tokenInfo) {
    throw new Error(`NL_PARSE_FAILED: unknown token ${symbol} on chain ${chain}`);
  }

  const callResp = await pocket.rpc(chain, "eth_call", [
    {
      to: tokenInfo.address,
      data: encodeBalanceOfCalldata(address),
    },
    "latest",
  ]);

  const raw = BigInt(callResp.result as string);
  return {
    chain,
    symbol,
    address,
    tokenAddress: tokenInfo.address,
    balance: formatTokenAmount(raw, tokenInfo.decimals),
    balanceRaw: raw.toString(),
    decimals: tokenInfo.decimals,
  };
}

export function formatErc20Balance(result: Erc20BalanceResult): string {
  const chainInfo = resolveChain(result.chain);
  const chainName = chainInfo?.name ?? result.chain;
  return `\n${result.symbol} balance on ${chainName}: ${result.balance} (${result.address})`;
}

export async function getErc20TokenBalance(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  token: string,
  address: string,
): Promise<Erc20BalanceResult> {
  const symbol = token.toUpperCase();
  if (KNOWN_TOKENS[chain]?.[symbol]) {
    return executeErc20Balance(pocket, chain, symbol, address);
  }

  if (/^0x[a-fA-F0-9]{40}$/.test(token)) {
    const callResp = await pocket.rpc(chain, "eth_call", [
      { to: token, data: encodeBalanceOfCalldata(address) },
      "latest",
    ]);
    const raw = BigInt(callResp.result as string);
    return {
      chain,
      symbol: token,
      address,
      tokenAddress: token,
      balance: raw.toString(),
      balanceRaw: raw.toString(),
      decimals: 18,
    };
  }

  throw new Error(`Unknown token ${token} on chain ${chain}`);
}
