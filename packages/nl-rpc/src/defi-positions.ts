import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { fetchUserDefiPositions } from "@pokt-mcp/integrations";
import { inferChain, normalizeQuery, resolveAddress, wantsMyWallet } from "./patterns.js";

/** Aave V3 Pool getUserAccountData selector */
const AAVE_GET_USER_DATA = "0x35ea6a75";

const AAVE_POOLS: Record<string, string> = {
  eth: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA2E2",
  base: "0xA238Dd80C259a72e81d7e4664a9801593FD08F32",
  "arb-one": "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  poly: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  opt: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  avax: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

export type AaveHealth = {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  healthFactor: number;
  liquidationRisk: "safe" | "warning" | "danger";
};

export type DefiPositionsResult = {
  address: string;
  chain: string;
  totalTvlUsd: number;
  positions: Array<{ protocol: string; chain: string; symbol: string; usdValue: number; type: string }>;
  aaveHealth?: AaveHealth;
  dataSources: Record<string, "available" | "skipped" | "unavailable">;
  summary: string;
  warnings: string[];
};

export function isDefiPositionsQuery(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\bdefi\s+positions?\b/.test(q) ||
    /\b(my\s+)?(aave|compound|lido|uniswap)\b.*\b(position|health|liquidat)/.test(q) ||
    /\bhealth\s+factor\b/.test(q) ||
    /\bliquidat(ion|e)\s+risk\b/.test(q) ||
    /\bmonitor\b.*\bdefi\b/.test(q) ||
    /\btotal\s+tvl\b.*\b(positions?|defi)\b/.test(q)
  );
}

export function matchDefiPositionsQuery(query: string, context?: SessionContext): RpcIntent | null {
  if (!isDefiPositionsQuery(query)) return null;

  const address = resolveAddress(query, context);
  if (!address) {
    if (wantsMyWallet(query)) {
      throw new Error("WALLET_NOT_CONNECTED: Connect wallet to view DeFi positions, or provide an address.");
    }
    return null;
  }

  const chain = inferChain(query, context);

  return {
    action: "read",
    chain,
    method: "__defi_positions__",
    params: [chain, address],
    humanSummary: `DeFi positions for ${address}`,
    riskLevel: "none",
  };
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

async function fetchAaveHealthFactor(
  pocket: PocketClient,
  chain: string,
  address: string,
): Promise<AaveHealth | undefined> {
  const pool = AAVE_POOLS[chain];
  if (!pool) return undefined;

  const calldata = AAVE_GET_USER_DATA + padAddress(address);
  try {
    const resp = await pocket.rpc(chain, "eth_call", [{ to: pool, data: calldata }, "latest"]);
    const hex = (resp.result as string)?.slice(2) ?? "";
    if (hex.length < 64 * 6) return undefined;

    const totalCollateralBase = BigInt("0x" + hex.slice(0, 64));
    const totalDebtBase = BigInt("0x" + hex.slice(64, 128));
    const healthFactorRaw = BigInt("0x" + hex.slice(256, 320));

    const healthFactor = Number(healthFactorRaw) / 1e18;
    const totalCollateralUsd = Number(totalCollateralBase) / 1e8;
    const totalDebtUsd = Number(totalDebtBase) / 1e8;

    const liquidationRisk: AaveHealth["liquidationRisk"] =
      healthFactor < 1.1 ? "danger" : healthFactor < 1.5 ? "warning" : "safe";

    return { totalCollateralUsd, totalDebtUsd, healthFactor, liquidationRisk };
  } catch {
    return undefined;
  }
}

export async function executeDefiPositions(
  pocket: PocketClient,
  chain: string,
  address: string,
): Promise<DefiPositionsResult> {
  const dataSources: DefiPositionsResult["dataSources"] = {
    defillama: "available",
    pocket_rpc: "available",
  };

  const warnings: string[] = [];
  const defi = await fetchUserDefiPositions(address);
  if (!defi.available) dataSources.defillama = "unavailable";

  const aaveHealth = await fetchAaveHealthFactor(pocket, chain, address);

  let totalTvlUsd = defi.totalUsd;
  if (aaveHealth && aaveHealth.totalCollateralUsd > 0) {
    totalTvlUsd = Math.max(totalTvlUsd, aaveHealth.totalCollateralUsd);
  }

  if (aaveHealth?.liquidationRisk === "danger") {
    warnings.push(`Critical: Aave health factor ${aaveHealth.healthFactor.toFixed(2)} — near liquidation`);
  } else if (aaveHealth?.liquidationRisk === "warning") {
    warnings.push(`Warning: Aave health factor ${aaveHealth.healthFactor.toFixed(2)} — monitor closely`);
  }

  if (defi.positions.length === 0 && !aaveHealth) {
    warnings.push("No indexed positions — DeFiLlama coverage varies by protocol");
  }

  const summary = [
    `DeFi monitor for ${address.slice(0, 10)}…`,
    `Total TVL: ~$${totalTvlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    defi.positions.length > 0 ? `${defi.positions.length} indexed position(s).` : defi.note ?? "",
    aaveHealth ? `Aave health factor: ${aaveHealth.healthFactor.toFixed(2)} (${aaveHealth.liquidationRisk}).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    address,
    chain,
    totalTvlUsd,
    positions: defi.positions,
    aaveHealth,
    dataSources,
    summary,
    warnings,
  };
}

export function formatDefiPositions(result: DefiPositionsResult): string {
  const lines = [result.summary];
  if (result.positions.length > 0) {
    lines.push("\nPositions:");
    for (const p of result.positions.slice(0, 8)) {
      lines.push(`• ${p.protocol} (${p.chain}): $${p.usdValue.toFixed(2)} ${p.symbol}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("\nWarnings:");
    for (const w of result.warnings) lines.push(`• ${w}`);
  }
  return lines.join("\n");
}
