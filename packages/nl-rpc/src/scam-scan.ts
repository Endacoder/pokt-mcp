import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import {
  fetchAddressSecurity,
  fetchContractSource,
  fetchTokenSecurity,
  loadExplorerApiKey,
  type RiskLevel,
} from "@pokt-mcp/integrations";
import { executeAccountAudit } from "./account-audit.js";
import { extractAddress, inferChain, normalizeQuery, resolveAddress, wantsMyWallet } from "./patterns.js";

export type ScamScanResult = {
  target: string;
  chain: string;
  targetType: "token" | "wallet" | "contract";
  riskLevel: RiskLevel;
  findings: Array<{ severity: RiskLevel; message: string; action?: string }>;
  tokenSecurity?: ReturnType<typeof fetchTokenSecurity> extends Promise<infer T> ? T : never;
  addressSecurity?: { riskLevel: RiskLevel; findings: Array<{ severity: RiskLevel; message: string }>; available: boolean };
  auditSummary?: string;
  recommendations: string[];
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
};

export function isScamScanQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(scam|rug\s*pull|honeypot|sketchy|suspicious|safe\s+to\s+(buy|interact))\b/.test(q) ||
    /\bscan\b.*\b(token|contract|address|wallet)\b/.test(q) ||
    /\bscan\s+0x[a-f0-9]{40}\b/.test(q) ||
    /\bis\s+0x[a-f0-9]{40}\s+(a\s+)?scam\b/.test(q) ||
    /\bcheck\b.*\bbefore\s+i\s+(buy|swap|interact)\b/.test(q)
  );
}

export function matchScamScanQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isScamScanQuery(query)) return null;

  const address = resolveAddress(query, context) ?? extractAddress(query);
  if (!address && wantsMyWallet(query)) {
    throw new Error("WALLET_NOT_CONNECTED: Connect wallet or provide an address to scan.");
  }
  if (!address) return null;

  const chain = inferChain(query, context);

  return {
    action: "read",
    chain,
    method: "__scam_scan__",
    params: [chain, address],
    humanSummary: `Scam/rug scan for ${address}`,
    riskLevel: "none",
  };
}

function mergeRiskLevel(...levels: RiskLevel[]): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  let max = 0;
  for (const l of levels) {
    max = Math.max(max, order.indexOf(l));
  }
  return order[max] ?? "low";
}

export async function executeScamScan(
  pocket: PocketClient,
  chain: string,
  address: string,
): Promise<ScamScanResult> {
  const dataSources: ScamScanResult["dataSources"] = {
    goplus: "available",
    etherscan: loadExplorerApiKey() ? "available" : "skipped",
    pocket_rpc: "available",
  };

  const findings: ScamScanResult["findings"] = [];
  const recommendations: string[] = [];

  let code = "0x";
  try {
    const resp = await pocket.rpc(chain, "eth_getCode", [address, "latest"]);
    code = (resp.result as string) ?? "0x";
  } catch {
    dataSources.pocket_rpc = "unavailable";
  }

  const isContract = code !== "0x" && code !== "0x0";
  const targetType: ScamScanResult["targetType"] = isContract ? "contract" : "wallet";

  let tokenSecurity: ScamScanResult["tokenSecurity"];
  let addressSecurity: ScamScanResult["addressSecurity"];

  if (isContract) {
    tokenSecurity = await fetchTokenSecurity(chain, address);
    if (!tokenSecurity.available) dataSources.goplus = "unavailable";
    for (const f of tokenSecurity.findings) {
      findings.push({ ...f, action: f.severity === "critical" ? "Do not interact" : "Review carefully" });
    }

    if (loadExplorerApiKey()) {
      const source = await fetchContractSource(chain, address);
      if (source && !source.verified) {
        findings.push({
          severity: "medium",
          message: "Unverified contract source",
          action: "Verify on block explorer before interacting",
        });
      }
      if (source?.proxy === "1" && !source.implementation) {
        findings.push({
          severity: "medium",
          message: "Proxy with unknown implementation",
          action: "Inspect implementation contract",
        });
      }
    }
  } else {
    const addrSec = await fetchAddressSecurity(chain, address);
    addressSecurity = addrSec;
    if (!addrSec.available) dataSources.goplus = "unavailable";
    for (const f of addrSec.findings) {
      findings.push({ ...f, action: "Avoid sending funds" });
    }
  }

  let auditSummary: string | undefined;
  // Wallet-only — auditing a token contract (e.g. USDC) scans millions of approval logs and hangs.
  if (!isContract) {
    try {
      const audit = await executeAccountAudit(pocket, address, {
        activityTxLimit: 0,
        activityBlockScanDepth: 0,
        approvalLogBlockRange: 10_000,
        maxApprovalsPerChain: 10,
        maxActiveChains: 5,
      });
      auditSummary = audit.summary;
      for (const f of audit.findings.slice(0, 5)) {
        findings.push({
          severity: f.severity === "high" ? "high" : f.severity === "low" ? "medium" : "low",
          message: f.message,
          action: f.message.toLowerCase().includes("approval") ? "Revoke unused approvals" : undefined,
        });
      }
    } catch {
      /* optional */
    }
  }

  const riskLevel = mergeRiskLevel(
    tokenSecurity?.riskLevel ?? "low",
    addressSecurity?.riskLevel ?? "low",
    ...findings.map((f) => f.severity),
  );

  if (riskLevel === "critical") recommendations.push("Do not interact with this address/contract");
  else if (riskLevel === "high") recommendations.push("Proceed with extreme caution — verify on multiple sources");
  else if (riskLevel === "medium") recommendations.push("Review findings before interacting");
  else recommendations.push("No major automated red flags — always DYOR");

  const summary = `${targetType === "contract" ? "Contract" : "Wallet"} scan for ${address} on ${chain}: ${riskLevel.toUpperCase()} risk (${findings.length} finding(s)).`;

  return {
    target: address,
    chain,
    targetType: isContract ? "token" : "wallet",
    riskLevel,
    findings,
    tokenSecurity,
    addressSecurity,
    auditSummary,
    recommendations,
    dataSources,
    summary,
  };
}

export function formatScamScan(result: ScamScanResult): string {
  const lines = [
    result.summary,
    `\nRisk: ${result.riskLevel.toUpperCase()}`,
    result.findings.length > 0
      ? `\nFindings:\n${result.findings.map((f) => `• [${f.severity}] ${f.message}${f.action ? ` → ${f.action}` : ""}`).join("\n")}`
      : "No findings.",
    `\nRecommendations:\n${result.recommendations.map((r) => `• ${r}`).join("\n")}`,
  ];
  return lines.join("\n");
}
