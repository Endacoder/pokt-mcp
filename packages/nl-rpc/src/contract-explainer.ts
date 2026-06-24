import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { fetchContractSource, loadExplorerApiKey } from "@pokt-mcp/integrations";
import { extractAddress, inferChain, normalizeQuery } from "./patterns.js";

/** EIP-1967 implementation slot */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type ContractFunctionSummary = {
  name: string;
  type: string;
  stateMutability: string;
  flags: string[];
};

export type ContractExplainerResult = {
  chain: string;
  address: string;
  verified: boolean;
  contractName: string;
  isProxy: boolean;
  implementationAddress?: string;
  functions: ContractFunctionSummary[];
  suspiciousPatterns: string[];
  verdict: "benign" | "review" | "suspicious";
  plainEnglishSummary: string;
  explorerUrl?: string;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
};

const SUSPICIOUS_NAMES = /mint|pause|blacklist|destroy|kill|selfdestruct|upgrade|setowner|renounce|withdraw/i;
const ADMIN_NAMES = /onlyowner|onlyadmin|onlyrole|admin|owner/i;

export function isContractExplainerQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bexplain\b.*\bcontract\b/.test(q) ||
    /\bwhat\s+does\b.*\bcontract\b/.test(q) ||
    /\bsmart\s+contract\b.*\b(explain|do|does|mean)\b/.test(q) ||
    /\bcontract\b.*\b(explain|suspicious|safe|proxy)\b/.test(q) ||
    /\bis\s+this\s+a\s+proxy\b/.test(q)
  );
}

export function matchContractExplainerQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isContractExplainerQuery(query)) return null;

  const address = extractAddress(query);
  if (!address) return null;

  const chain = inferChain(query, context);

  return {
    action: "read",
    chain,
    method: "__explain_contract__",
    params: [chain, address],
    humanSummary: `Explain contract ${address} on ${chain}`,
    riskLevel: "none",
  };
}

function parseAbiFunctions(abiJson: string): ContractFunctionSummary[] {
  if (!abiJson || abiJson === "Contract source code not verified") return [];

  try {
    const abi = JSON.parse(abiJson) as Array<{
      type?: string;
      name?: string;
      stateMutability?: string;
    }>;

    return abi
      .filter((item) => item.type === "function" && item.name)
      .map((item) => {
        const name = item.name ?? "";
        const flags: string[] = [];
        if (SUSPICIOUS_NAMES.test(name)) flags.push("sensitive");
        if (ADMIN_NAMES.test(name)) flags.push("admin");
        if (item.stateMutability === "payable") flags.push("payable");
        return {
          name,
          type: "function",
          stateMutability: item.stateMutability ?? "nonpayable",
          flags,
        };
      });
  } catch {
    return [];
  }
}

export async function executeContractExplainer(
  pocket: PocketClient,
  chain: string,
  address: string,
): Promise<ContractExplainerResult> {
  const dataSources: ContractExplainerResult["dataSources"] = {
    etherscan: loadExplorerApiKey() ? "available" : "skipped",
    pocket_rpc: "available",
  };

  const source = loadExplorerApiKey() ? await fetchContractSource(chain, address) : null;
  if (!source && loadExplorerApiKey()) dataSources.etherscan = "unavailable";

  let isProxy = source?.proxy === "1";
  let implementationAddress = source?.implementation || undefined;

  if (!implementationAddress) {
    try {
      const slotResp = await pocket.rpc(chain, "eth_getStorageAt", [address, IMPLEMENTATION_SLOT, "latest"]);
      const slot = slotResp.result as string;
      if (slot && slot !== "0x" + "0".repeat(64)) {
        isProxy = true;
        implementationAddress = "0x" + slot.slice(-40);
      }
    } catch {
      /* optional */
    }
  }

  const functions = source?.abi ? parseAbiFunctions(source.abi) : [];
  const suspiciousPatterns: string[] = [];

  if (!source?.verified) {
    suspiciousPatterns.push("Contract source is not verified on block explorer");
  }
  if (isProxy) {
    suspiciousPatterns.push(`Proxy contract — logic may live at ${implementationAddress ?? "unknown implementation"}`);
  }

  const sensitiveFns = functions.filter((f) => f.flags.includes("sensitive"));
  if (sensitiveFns.length > 0) {
    suspiciousPatterns.push(`Sensitive functions: ${sensitiveFns.map((f) => f.name).slice(0, 5).join(", ")}`);
  }

  const adminFns = functions.filter((f) => f.flags.includes("admin"));
  if (adminFns.length > 3) {
    suspiciousPatterns.push("Many admin-controlled functions — review access control");
  }

  let verdict: ContractExplainerResult["verdict"] = "benign";
  if (!source?.verified || suspiciousPatterns.length >= 3) verdict = "suspicious";
  else if (suspiciousPatterns.length > 0 || isProxy) verdict = "review";

  const chainInfo = await import("@pokt-mcp/pocket-client").then((m) => m.resolveChain(chain));
  const explorerUrl = chainInfo?.blockExplorer ? `${chainInfo.blockExplorer}/address/${address}` : undefined;

  const plainEnglishSummary = [
    source?.verified
      ? `${source.contractName || "Contract"} at ${address} is verified on ${chain}.`
      : `Unverified contract at ${address} on ${chain}.`,
    isProxy ? "This is a proxy — implementation can be upgraded." : "",
    functions.length > 0 ? `${functions.length} public/external functions detected.` : "No verified ABI available.",
    verdict === "suspicious"
      ? "Review carefully before interacting."
      : verdict === "review"
        ? "Some patterns warrant manual review."
        : "No major red flags from automated analysis.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    chain,
    address,
    verified: source?.verified ?? false,
    contractName: source?.contractName ?? "",
    isProxy,
    implementationAddress,
    functions: functions.slice(0, 30),
    suspiciousPatterns,
    verdict,
    plainEnglishSummary,
    explorerUrl,
    dataSources,
  };
}

export function formatContractExplainer(result: ContractExplainerResult): string {
  const lines = [
    result.plainEnglishSummary,
    `\nVerdict: ${result.verdict.toUpperCase()}`,
    result.suspiciousPatterns.length > 0
      ? `\nFindings:\n${result.suspiciousPatterns.map((p) => `• ${p}`).join("\n")}`
      : "",
    result.functions.length > 0
      ? `\nKey functions:\n${result.functions.slice(0, 10).map((f) => `• ${f.name} (${f.stateMutability})${f.flags.length ? ` [${f.flags.join(", ")}]` : ""}`).join("\n")}`
      : "",
    result.explorerUrl ? `\nExplorer: ${result.explorerUrl}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
