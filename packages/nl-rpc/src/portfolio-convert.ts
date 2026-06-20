import type { WalletPortfolioSnapshot } from "@pokt-mcp/shared";
import { formatConvertedAmount } from "./convert.js";

const CHAIN_NATIVE_IDS: Record<string, string> = {
  eth: "ethereum",
  base: "ethereum",
  "arb-one": "ethereum",
  opt: "ethereum",
  scroll: "ethereum",
  blast: "ethereum",
  linea: "ethereum",
  zksync: "ethereum",
  fraxtal: "ethereum",
  poly: "polygon-ecosystem-token",
  avax: "avalanche-2",
  bsc: "binancecoin",
  gnosis: "xdai",
  fantom: "fantom",
  celo: "celo",
  bera: "berachain",
  mantle: "mantle",
  moonbeam: "moonbeam",
  kava: "kava",
  metis: "metis-token",
};

const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);

export type PortfolioConvertLine = {
  chainName: string;
  label: string;
  usdValue: number;
};

export type PortfolioConvertResult = {
  address: string;
  targetSymbol: string;
  targetVs: string;
  totalUsd: number;
  totalConverted: number;
  lines: PortfolioConvertLine[];
  chainCount: number;
};

async function fetchUsdPrices(coingeckoIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(coingeckoIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Price lookup failed (${res.status})`);
  }
  const json = (await res.json()) as Record<string, { usd?: number }>;
  const out: Record<string, number> = {};
  for (const id of ids) {
    const price = json[id]?.usd;
    if (price !== undefined) out[id] = price;
  }
  return out;
}

function parsePositive(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function convertWalletPortfolio(
  portfolio: WalletPortfolioSnapshot,
  targetVs: string,
  targetSymbol: string,
): Promise<PortfolioConvertResult> {
  const coingeckoIds = portfolio.chains
    .map((c) => CHAIN_NATIVE_IDS[c.chain])
    .filter((id): id is string => Boolean(id));
  const prices = await fetchUsdPrices(coingeckoIds);

  const lines: PortfolioConvertLine[] = [];
  let totalUsd = 0;

  for (const chain of portfolio.chains) {
    const parts: string[] = [];
    let chainUsd = 0;

    const nativeAmt = parsePositive(chain.nativeBalance);
    if (nativeAmt > 0) {
      const id = CHAIN_NATIVE_IDS[chain.chain];
      const price = id ? prices[id] : undefined;
      if (price !== undefined) {
        const usd = nativeAmt * price;
        chainUsd += usd;
        parts.push(`${chain.nativeBalance} ${chain.nativeSymbol}`);
      }
    }

    for (const token of chain.tokens) {
      const amt = parsePositive(token.balance);
      if (amt <= 0) continue;
      if (STABLECOIN_SYMBOLS.has(token.symbol.toUpperCase())) {
        chainUsd += amt;
        parts.push(`${token.balance} ${token.symbol}`);
      }
    }

    if (chainUsd > 0) {
      totalUsd += chainUsd;
      lines.push({
        chainName: chain.chainName,
        label: parts.join(", "),
        usdValue: chainUsd,
      });
    }
  }

  let totalConverted = totalUsd;
  if (targetVs !== "usd") {
    const crossPrices = await fetchUsdPrices(
      targetVs === "btc" ? ["bitcoin"] : targetVs === "eth" ? ["ethereum"] : [],
    );
    const crossUsd =
      targetVs === "btc"
        ? crossPrices.bitcoin
        : targetVs === "eth"
          ? crossPrices.ethereum
          : undefined;
    if (!crossUsd || crossUsd === 0) {
      throw new Error(`No ${targetSymbol} rate available for portfolio conversion`);
    }
    totalConverted = totalUsd / crossUsd;
  }

  return {
    address: portfolio.address,
    targetSymbol,
    targetVs,
    totalUsd,
    totalConverted,
    lines,
    chainCount: portfolio.chains.length,
  };
}

export function formatPortfolioConversion(result: PortfolioConvertResult): string {
  const shortAddr = `${result.address.slice(0, 6)}…${result.address.slice(-4)}`;
  const total = formatConvertedAmount(result.totalConverted, result.targetSymbol, result.targetVs);
  const header =
    result.chainCount > 1
      ? `Wallet ${shortAddr} across ${result.chainCount} chains ≈ ${total} ${result.targetSymbol}:`
      : `Wallet ${shortAddr} ≈ ${total} ${result.targetSymbol}:`;

  const breakdown = result.lines.map(
    (line) =>
      `- ${line.chainName}: ~${formatConvertedAmount(line.usdValue, "USD", "usd")} USD (${line.label})`,
  );

  return `\n${[header, ...breakdown].join("\n")}`;
}

export function snapshotFromWalletBalances(
  result: import("./wallet-balance.js").WalletBalancesResult,
): WalletPortfolioSnapshot {
  return {
    address: result.address,
    chains: [
      {
        chain: result.chain,
        chainName: result.chainName,
        nativeSymbol: result.nativeSymbol,
        nativeBalance: result.nativeBalance,
        tokens: result.tokens
          .filter((t) => parsePositive(t.balance) > 0)
          .map((t) => ({ symbol: t.symbol, balance: t.balance })),
      },
    ],
  };
}

export function snapshotFromMultiWalletBalances(
  result: import("./wallet-balance.js").MultiWalletBalancesResult,
): WalletPortfolioSnapshot {
  return {
    address: result.address,
    scanned: result.scanned,
    chains: result.chains.map((c) => ({
      chain: c.chain,
      chainName: c.chainName,
      nativeSymbol: c.nativeSymbol,
      nativeBalance: c.nativeBalance,
      tokens: c.tokens
        .filter((t) => parsePositive(t.balance) > 0)
        .map((t) => ({ symbol: t.symbol, balance: t.balance })),
    })),
  };
}
