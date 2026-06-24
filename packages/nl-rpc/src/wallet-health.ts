import type { RpcIntent } from "@pokt-mcp/shared";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import {
  estimateGasFeesFromTxs,
  fetchTokenTransfers,
  loadExplorerApiKey,
} from "@pokt-mcp/integrations";
import { executeAccountAudit, CHAT_ACCOUNT_AUDIT_OPTIONS, type AccountAuditOptions, type AccountAuditResult } from "./account-audit.js";
import { fetchExplorerTxList } from "./explorer-api.js";
import { normalizeQuery, resolveAddress, wantsMyWallet } from "./patterns.js";
import type { SessionContext } from "@pokt-mcp/shared";

/** Lighter audit scope — full defaults scan 50k blocks × every active chain and can hang on busy wallets. */
const WALLET_HEALTH_AUDIT_OPTIONS: AccountAuditOptions = CHAT_ACCOUNT_AUDIT_OPTIONS;

const EXPLORER_TX_LIMIT = 100;
const EXPLORER_FETCH_TIMEOUT_MS = 45_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type WalletHealthResult = {
  address: string;
  healthScore: number;
  healthLabel: "excellent" | "good" | "fair" | "poor";
  gasFeesSpentEth: number;
  gasFeesPeriodDays: number;
  gasFeesTxCount: number;
  audit: AccountAuditResult;
  tokenHistory: Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    tokenSymbol: string;
    timeStamp?: string;
  }>;
  estimatedProfitNote: string;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
  recommendations: string[];
};

export function isWalletHealthQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bwallet\s+health\b/.test(q) ||
    /\bhealth\s+check\b.*\b(wallet|account)\b/.test(q) ||
    /\bhow\s+much\b.*\b(gas|fees?)\b.*\b(spent|paid)\b/.test(q) ||
    /\bhow\s+much\b.*\b(spent|paid)\b.*\b(gas|fees?)\b/.test(q) ||
    /\b(gas|fees?)\s+spent\b/.test(q) ||
    /\btoken\s+history\b/.test(q) ||
    /\b(profits?|pnl|profit\s+and\s+loss)\b.*\b(wallet|made|earned)\b/.test(q)
  );
}

export function matchWalletHealthQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isWalletHealthQuery(query)) return null;

  const address = resolveAddress(query, context);
  if (!address) {
    if (wantsMyWallet(query)) {
      throw new Error("WALLET_NOT_CONNECTED: Connect your wallet for a health check, or provide an address.");
    }
    return null;
  }

  return {
    action: "read",
    chain: "eth",
    method: "__wallet_health__",
    params: [address],
    humanSummary: `Wallet health check for ${address}`,
    riskLevel: "none",
  };
}

function computeHealthScore(audit: AccountAuditResult, gasFeesEth: number): { score: number; label: WalletHealthResult["healthLabel"] } {
  let score = 100;

  if (audit.riskLevel === "high") score -= 35;
  else if (audit.riskLevel === "low") score -= 10;

  const unlimited = audit.findings.filter((f) => f.message.toLowerCase().includes("unlimited")).length;
  score -= Math.min(unlimited * 10, 30);

  if (gasFeesEth > 1) score -= 5;
  if ((audit.portfolio?.totalUsd ?? 0) < 50 && gasFeesEth > 0.1) score -= 10;

  score = Math.max(0, Math.min(100, score));

  const label: WalletHealthResult["healthLabel"] =
    score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor";

  return { score, label };
}

export async function executeWalletHealth(
  pocket: PocketClient,
  address: string,
): Promise<WalletHealthResult> {
  const dataSources: WalletHealthResult["dataSources"] = {
    pocket_rpc: "available",
    coingecko: "available",
    etherscan: "skipped",
  };

  const audit = await executeAccountAudit(pocket, address, WALLET_HEALTH_AUDIT_OPTIONS);

  let gasFeesSpentEth = 0;
  let gasFeesTxCount = 0;
  const periodDays = 90;
  let tokenHistory: WalletHealthResult["tokenHistory"] = [];

  const apiKey = loadExplorerApiKey();
  if (apiKey) {
    dataSources.etherscan = "available";
    try {
      const txs = await withTimeout(
        fetchExplorerTxList("eth", address, EXPLORER_TX_LIMIT, apiKey),
        EXPLORER_FETCH_TIMEOUT_MS,
        "Etherscan tx history",
      );
      const fees = estimateGasFeesFromTxs(
        txs.map((t) => ({ gasUsed: (t as { gasUsed?: string }).gasUsed, gasPrice: (t as { gasPrice?: string }).gasPrice, timeStamp: t.timeStamp })),
        periodDays,
      );
      gasFeesSpentEth = fees.totalEth;
      gasFeesTxCount = fees.txCount;
      tokenHistory = await withTimeout(
        fetchTokenTransfers("eth", address, 20, apiKey),
        EXPLORER_FETCH_TIMEOUT_MS,
        "Etherscan token transfers",
      );
    } catch {
      dataSources.etherscan = "unavailable";
    }
  }

  const { score, label } = computeHealthScore(audit, gasFeesSpentEth);

  const recommendations: string[] = [];
  if (audit.riskLevel !== "low") {
    recommendations.push("Review token approvals — unlimited allowances detected");
  }
  if (gasFeesSpentEth > 0.5) {
    recommendations.push(`Consider batching txs — ~${gasFeesSpentEth.toFixed(4)} ETH spent on gas in ${periodDays}d`);
  }
  if ((audit.portfolio?.totalUsd ?? 0) === 0 && audit.activeChains > 0) {
    recommendations.push("Low portfolio value — ensure sufficient gas reserve on active chains");
  }

  const summary = [
    `Wallet health: ${label} (${score}/100) for ${address}.`,
    gasFeesTxCount > 0 ? `Gas spent (est. ${periodDays}d): ${gasFeesSpentEth.toFixed(6)} ETH across ${gasFeesTxCount} txs.` : "",
    audit.portfolio ? `Portfolio: ~$${audit.portfolio.totalUsd.toFixed(2)} USD.` : "",
    audit.findings.length > 0 ? `${audit.findings.length} security finding(s).` : "No critical security findings.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    address,
    healthScore: score,
    healthLabel: label,
    gasFeesSpentEth,
    gasFeesPeriodDays: periodDays,
    gasFeesTxCount,
    audit,
    tokenHistory,
    estimatedProfitNote:
      "Profit/loss is estimated only — full cost-basis tracking requires an indexer. Token inflows/outflows are shown in token history.",
    dataSources,
    summary,
    recommendations,
  };
}

export function formatWalletHealth(result: WalletHealthResult): string {
  const lines = [
    result.summary,
    "",
    `Health score: ${result.healthScore}/100 (${result.healthLabel})`,
    result.gasFeesTxCount > 0
      ? `Gas fees (${result.gasFeesPeriodDays}d): ${result.gasFeesSpentEth.toFixed(6)} ETH (${result.gasFeesTxCount} txs)`
      : "Gas fee history: set EXPLORER_API_KEY for detailed fee tracking",
    result.audit.portfolio ? `Portfolio: $${result.audit.portfolio.totalUsd.toFixed(2)} USD` : "",
    result.recommendations.length > 0 ? `\nRecommendations:\n${result.recommendations.map((r) => `• ${r}`).join("\n")}` : "",
    `\n${result.estimatedProfitNote}`,
  ];
  return lines.filter(Boolean).join("\n");
}
