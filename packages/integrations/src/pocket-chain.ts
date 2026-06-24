import {
  loadPocketLcdUrl,
  loadPocketOperatorAddress,
  loadPocketOperatorMetricsUrl,
} from "./config.js";

export type SupplierInfo = {
  operatorAddress: string;
  owner: string;
  services: Array<{ serviceId: string; endpoints: string[] }>;
  stake: string;
  unstakingTime?: string;
};

export type OperatorMetrics = {
  relayRequestsTotal?: number;
  claimsSubmitted?: number;
  proofsSubmitted?: number;
  available: boolean;
};

export type OperatorStatusResult = {
  supplierAddress: string;
  supplier: SupplierInfo | null;
  metrics: OperatorMetrics;
  relayMiningDifficulty: Array<{ serviceId: string; difficulty: string }>;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  note?: string;
};

const DEFAULT_LCD = "https://shannon-grove-api.mainnet.poktroll.com";

export function loadEffectiveLcdUrl(): string | undefined {
  return loadPocketLcdUrl() || DEFAULT_LCD;
}

export function loadEffectiveOperatorAddress(override?: string): string | undefined {
  return override?.trim() || loadPocketOperatorAddress();
}

export async function fetchSupplierInfo(
  supplierAddress: string,
  lcdUrl?: string,
): Promise<SupplierInfo | null> {
  const base = lcdUrl ?? loadEffectiveLcdUrl();
  if (!base) return null;

  try {
    const url = `${base.replace(/\/$/, "")}/poktroll/supplier/supplier/${supplierAddress}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      supplier?: {
        operator_address?: string;
        owner_address?: string;
        services?: Array<{ service_id?: string; endpoints?: Array<{ url?: string }> }>;
        stake?: { amount?: string };
        unstaking_time?: string;
      };
    };

    const s = json.supplier;
    if (!s) return null;

    return {
      operatorAddress: s.operator_address ?? supplierAddress,
      owner: s.owner_address ?? "",
      services: (s.services ?? []).map((svc) => ({
        serviceId: svc.service_id ?? "",
        endpoints: (svc.endpoints ?? []).map((e) => e.url ?? "").filter(Boolean),
      })),
      stake: s.stake?.amount ?? "0",
      unstakingTime: s.unstaking_time,
    };
  } catch {
    return null;
  }
}

export async function fetchRelayMiningDifficulty(lcdUrl?: string): Promise<Array<{ serviceId: string; difficulty: string }>> {
  const base = lcdUrl ?? loadEffectiveLcdUrl();
  if (!base) return [];

  try {
    const url = `${base.replace(/\/$/, "")}/poktroll/service/relay-mining-difficulty-all`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      relay_mining_difficulty?: Array<{ service_id?: string; difficulty?: { value?: string } }>;
    };

    return (json.relay_mining_difficulty ?? []).map((d) => ({
      serviceId: d.service_id ?? "",
      difficulty: d.difficulty?.value ?? "0",
    }));
  } catch {
    return [];
  }
}

export async function fetchPrometheusMetrics(metricsUrl?: string): Promise<OperatorMetrics> {
  const url = metricsUrl ?? loadPocketOperatorMetricsUrl();
  if (!url) {
    return { available: false };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { available: false };

    const text = await res.text();
    const parseCounter = (name: string): number | undefined => {
      const match = text.match(new RegExp(`^${name}\\s+(\\d+(?:\\.\\d+)?)`, "m"));
      return match ? Number(match[1]) : undefined;
    };

    return {
      relayRequestsTotal: parseCounter("requests_total") ?? parseCounter("pokt_relay_requests_total"),
      claimsSubmitted: parseCounter("claims_submitted_total") ?? parseCounter("pokt_claims_submitted_total"),
      proofsSubmitted: parseCounter("proofs_submitted_total") ?? parseCounter("pokt_proofs_submitted_total"),
      available: true,
    };
  } catch {
    return { available: false };
  }
}

export async function fetchOperatorStatus(supplierAddress?: string): Promise<OperatorStatusResult> {
  const address = loadEffectiveOperatorAddress(supplierAddress);
  const dataSources: OperatorStatusResult["dataSources"] = {
    pocket_lcd: loadEffectiveLcdUrl() ? "available" : "skipped",
    prometheus: loadPocketOperatorMetricsUrl() ? "available" : "skipped",
  };

  if (!address) {
    return {
      supplierAddress: "",
      supplier: null,
      metrics: { available: false },
      relayMiningDifficulty: [],
      dataSources,
      note: "Set POCKET_OPERATOR_ADDRESS or provide a supplier address in your query",
    };
  }

  const [supplier, relayMiningDifficulty, metrics] = await Promise.all([
    fetchSupplierInfo(address),
    fetchRelayMiningDifficulty(),
    fetchPrometheusMetrics(),
  ]);

  if (!supplier) {
    dataSources.pocket_lcd = "unavailable";
  }

  if (!metrics.available) {
    dataSources.prometheus = dataSources.prometheus === "available" ? "unavailable" : dataSources.prometheus;
  }

  const supplierServices = new Set(supplier?.services.map((s) => s.serviceId) ?? []);
  const rankedDifficulty = relayMiningDifficulty
    .filter((d) => supplierServices.size === 0 || supplierServices.has(d.serviceId))
    .sort((a, b) => Number(b.difficulty) - Number(a.difficulty));

  return {
    supplierAddress: address,
    supplier,
    metrics,
    relayMiningDifficulty: rankedDifficulty.slice(0, 10),
    dataSources,
    note: supplier
      ? undefined
      : "Supplier not found on Pocket Shannon chain — verify POCKET_LCD_URL and address",
  };
}
