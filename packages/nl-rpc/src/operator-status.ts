import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { fetchOperatorStatus, loadEffectiveOperatorAddress } from "@pokt-mcp/integrations";
import { extractAddress, normalizeQuery } from "./patterns.js";

export type OperatorStatusHandlerResult = {
  supplierAddress: string;
  supplier: {
    operatorAddress: string;
    owner: string;
    stake: string;
    services: Array<{ serviceId: string; endpoints: string[] }>;
  } | null;
  metrics: {
    relayRequestsTotal?: number;
    claimsSubmitted?: number;
    proofsSubmitted?: number;
    available: boolean;
  };
  relayMiningDifficulty: Array<{ serviceId: string; difficulty: string }>;
  mostProfitableChains: Array<{ serviceId: string; difficulty: string; rank: number }>;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
  note?: string;
};

export function isOperatorStatusQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(node\s+operator|operator\s+dashboard|supplier|relayminer|relay\s+miner)\b/.test(q) ||
    /\brelay\s+counts?\b/.test(q) ||
    /\b(my\s+)?(node|operator)\b.*\b(earnings?|rewards?|relays?|status)\b/.test(q) ||
    /\bmost\s+profitable\s+chain\b/.test(q) ||
    /\bpokt1[a-z0-9]{38,}\b/.test(q) ||
    /\bsupplier\s+status\b/.test(q)
  );
}

export function matchOperatorStatusQuery(query: string, _context?: SessionContext): RpcIntent | null {
  if (!isOperatorStatusQuery(query)) return null;

  const poktMatch = query.match(/\b(pokt1[a-z0-9]{38,})\b/i);
  const address = poktMatch?.[1] ?? loadEffectiveOperatorAddress() ?? "";

  return {
    action: "read",
    chain: "pocket",
    method: "__operator_status__",
    params: [address, query],
    humanSummary: address ? `Operator status for ${address}` : "Pocket node operator status",
    riskLevel: "none",
  };
}

export async function executeOperatorStatus(
  supplierAddress: string,
  _query: string,
): Promise<OperatorStatusHandlerResult> {
  const result = await fetchOperatorStatus(supplierAddress || undefined);

  const mostProfitableChains = result.relayMiningDifficulty
    .slice(0, 5)
    .map((d: { serviceId: string; difficulty: string }, i: number) => ({ ...d, rank: i + 1 }));

  const stakePokt = result.supplier?.stake
    ? (Number(result.supplier.stake) / 1e6).toFixed(2)
    : undefined;

  const summary = [
    result.supplierAddress
      ? `Operator ${result.supplierAddress.slice(0, 16)}…`
      : "Pocket operator query",
    result.supplier
      ? `${result.supplier.services.length} service(s), stake: ${stakePokt ?? "?"} POKT`
      : result.note ?? "Supplier not found",
    result.metrics.available && result.metrics.relayRequestsTotal !== undefined
      ? `Relay requests: ${result.metrics.relayRequestsTotal.toLocaleString()}`
      : "",
    mostProfitableChains.length > 0
      ? `Top service by mining difficulty: ${mostProfitableChains[0]?.serviceId}`
      : "",
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    supplierAddress: result.supplierAddress,
    supplier: result.supplier,
    metrics: result.metrics,
    relayMiningDifficulty: result.relayMiningDifficulty,
    mostProfitableChains,
    dataSources: result.dataSources,
    summary,
    note: result.note,
  };
}

export function formatOperatorStatus(result: OperatorStatusHandlerResult): string {
  const lines = [result.summary];

  if (result.supplier?.services.length) {
    lines.push("\nServices:");
    for (const s of result.supplier.services.slice(0, 8)) {
      lines.push(`• ${s.serviceId} (${s.endpoints.length} endpoint(s))`);
    }
  }

  if (result.mostProfitableChains.length > 0) {
    lines.push("\nRelay mining difficulty (higher = more competitive):");
    for (const c of result.mostProfitableChains) {
      lines.push(`• #${c.rank} ${c.serviceId}: ${c.difficulty}`);
    }
  }

  if (result.metrics.available) {
    lines.push("\nMetrics:");
    if (result.metrics.relayRequestsTotal !== undefined) {
      lines.push(`• Relay requests: ${result.metrics.relayRequestsTotal}`);
    }
    if (result.metrics.claimsSubmitted !== undefined) {
      lines.push(`• Claims submitted: ${result.metrics.claimsSubmitted}`);
    }
    if (result.metrics.proofsSubmitted !== undefined) {
      lines.push(`• Proofs submitted: ${result.metrics.proofsSubmitted}`);
    }
  } else {
    lines.push("\nSet POCKET_OPERATOR_METRICS_URL for live relay throughput from Prometheus.");
  }

  if (result.note) lines.push(`\nNote: ${result.note}`);

  return lines.join("\n");
}
