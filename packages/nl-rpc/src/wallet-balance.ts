import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { inferChain, wantsBalance, wantsMultiChainWalletBalance, wantsMyWallet } from "./patterns.js";
import { KNOWN_TOKENS } from "./tokens.js";

const BALANCE_OF_SELECTOR = "0x70a08231";

export { wantsMyWallet } from "./patterns.js";

export function isWalletBalanceQuery(query: string): boolean {
  return wantsMyWallet(query) && wantsBalance(query);
}

export function matchWalletBalanceQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isWalletBalanceQuery(query)) return null;

  const address = context?.connectedAddress;

  if (!address) {
    throw new Error(
      "WALLET_NOT_CONNECTED: Connect your wallet to check your balance, or provide an explicit address.",
    );
  }

  if (wantsMultiChainWalletBalance(query)) {
    return {
      action: "read",
      chain: inferChain(query, context),
      method: "__wallet_balances_multi__",
      params: [address],
      humanSummary: `Wallet balances for connected address across Pocket mainnets`,
      riskLevel: "none",
    };
  }

  const chain = inferChain(query, context);

  return {
    action: "read",
    chain,
    method: "__wallet_balances__",
    params: [chain, address],
    humanSummary: `Wallet balances for connected address on ${chain}`,
    riskLevel: "none",
  };
}

export type WalletTokenBalance = {
  symbol: string;
  balance: string;
  decimals: number;
};

export type WalletBalancesResult = {
  chain: string;
  chainName: string;
  address: string;
  nativeSymbol: string;
  nativeBalance: string;
  tokens: WalletTokenBalance[];
};

export type MultiWalletBalancesResult = {
  address: string;
  chains: WalletBalancesResult[];
  scanned: number;
};

function padAddress(address: string): string {
  return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function encodeBalanceOfCalldata(address: string): string {
  return `${BALANCE_OF_SELECTOR}${padAddress(address)}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function formatNativeAmount(weiHex: string): string {
  const wei = BigInt(weiHex);
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function nativeBalanceToWeiHex(balance: string): string {
  const [wholeRaw, fracRaw = ""] = balance.split(".");
  const whole = wholeRaw.replace(/[^\d]/g, "") || "0";
  const frac = fracRaw.replace(/[^\d]/g, "").padEnd(18, "0").slice(0, 18);
  const wei = BigInt(whole) * 10n ** 18n + BigInt(frac || "0");
  return `0x${wei.toString(16)}`;
}

export async function executeWalletBalances(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
): Promise<WalletBalancesResult> {
  const chainInfo = resolveChain(chain);
  const nativeSymbol = chainInfo?.nativeSymbol ?? "ETH";
  const chainName = chainInfo?.name ?? chain;

  const nativeResp = await pocket.rpc(chain, "eth_getBalance", [address, "latest"]);
  const nativeBalance = formatNativeAmount(nativeResp.result as string);

  const tokens: WalletTokenBalance[] = [];
  const known = KNOWN_TOKENS[chain] ?? {};

  for (const [symbol, info] of Object.entries(known)) {
    if (symbol !== "USDC" && symbol !== "USDT") continue;
    try {
      const callResp = await pocket.rpc(chain, "eth_call", [
        {
          to: info.address,
          data: encodeBalanceOfCalldata(address),
        },
        "latest",
      ]);
      const raw = BigInt(callResp.result as string);
      tokens.push({
        symbol,
        balance: formatTokenAmount(raw, info.decimals),
        decimals: info.decimals,
      });
    } catch {
      tokens.push({ symbol, balance: "0", decimals: info.decimals });
    }
  }

  return {
    chain,
    chainName,
    address,
    nativeSymbol,
    nativeBalance,
    tokens,
  };
}

function hasNonZeroBalance(result: WalletBalancesResult): boolean {
  if (parseFloat(result.nativeBalance) > 0) return true;
  return result.tokens.some((t) => parseFloat(t.balance) > 0);
}

export async function executeWalletBalancesMulti(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  address: string,
): Promise<MultiWalletBalancesResult> {
  const targets = listChains().filter((c) => c.protocol === "evm" && !c.testnet);
  const settled = await Promise.all(
    targets.map(async (chain) => {
      try {
        return await executeWalletBalances(pocket, chain.slug, address);
      } catch {
        return null;
      }
    }),
  );

  const chains = settled.filter((r): r is WalletBalancesResult => r !== null && hasNonZeroBalance(r));

  return {
    address,
    chains,
    scanned: targets.length,
  };
}

export function formatWalletBalances(result: WalletBalancesResult): string {
  const shortAddr = `${result.address.slice(0, 6)}…${result.address.slice(-4)}`;
  const lines = [
    `Your wallet ${shortAddr} on ${result.chainName} (${result.chain}):`,
    `- ${result.nativeSymbol}: ${result.nativeBalance}`,
  ];
  for (const t of result.tokens) {
    lines.push(`- ${t.symbol}: ${t.balance}`);
  }
  return `\n${lines.join("\n")}`;
}

export function formatMultiWalletBalances(result: MultiWalletBalancesResult): string {
  const shortAddr = `${result.address.slice(0, 6)}…${result.address.slice(-4)}`;
  if (result.chains.length === 0) {
    return `\nWallet ${shortAddr}: no non-zero balances found across ${result.scanned} Pocket mainnets.`;
  }

  const lines = [
    `Your wallet ${shortAddr} across ${result.scanned} Pocket mainnets (${result.chains.length} with balance):`,
  ];
  for (const chain of result.chains) {
    const tokenParts = chain.tokens
      .filter((t) => parseFloat(t.balance) > 0)
      .map((t) => `${t.symbol}: ${t.balance}`);
    const extras = tokenParts.length ? `, ${tokenParts.join(", ")}` : "";
    lines.push(`- ${chain.chainName}: ${chain.nativeBalance} ${chain.nativeSymbol}${extras}`);
  }
  return `\n${lines.join("\n")}`;
}
