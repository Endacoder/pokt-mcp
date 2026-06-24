import { loadDefiLlamaBaseUrl } from "./config.js";

export type DefiProtocolPosition = {
  protocol: string;
  chain: string;
  symbol: string;
  usdValue: number;
  type: string;
};

export type DefiUserPositions = {
  address: string;
  totalUsd: number;
  positions: DefiProtocolPosition[];
  available: boolean;
  note?: string;
};

export type DexVolumeSummary = {
  chain: string;
  totalVolume24h: number;
  change1d?: number;
  available: boolean;
};

const CHAIN_TO_DEFILLAMA: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  "arb-one": "Arbitrum",
  poly: "Polygon",
  opt: "Optimism",
  avax: "Avalanche",
  bsc: "BSC",
};

export function chainToDefiLlama(chain: string): string | undefined {
  return CHAIN_TO_DEFILLAMA[chain];
}

export async function fetchDexVolumeSummary(chain: string): Promise<DexVolumeSummary> {
  const llamaChain = chainToDefiLlama(chain);
  const base = loadDefiLlamaBaseUrl();

  if (!llamaChain) {
    return { chain, totalVolume24h: 0, available: false };
  }

  try {
    const res = await fetch(`${base}/overview/dexs/${llamaChain}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`);
    if (!res.ok) return { chain, totalVolume24h: 0, available: false };

    const json = (await res.json()) as {
      total24h?: number;
      change_1d?: number;
    };

    return {
      chain,
      totalVolume24h: json.total24h ?? 0,
      change1d: json.change_1d,
      available: true,
    };
  } catch {
    return { chain, totalVolume24h: 0, available: false };
  }
}

export async function fetchUserDefiPositions(address: string): Promise<DefiUserPositions> {
  const base = loadDefiLlamaBaseUrl();

  try {
    const res = await fetch(`${base}/user/${address.toLowerCase()}`);
    if (!res.ok) {
      return {
        address,
        totalUsd: 0,
        positions: [],
        available: false,
        note: "DeFiLlama user positions not available for this address",
      };
    }

    const json = (await res.json()) as Array<{
      name?: string;
      chain?: string;
      symbol?: string;
      usd_value?: number;
      category?: string;
    }>;

    if (!Array.isArray(json)) {
      return {
        address,
        totalUsd: 0,
        positions: [],
        available: false,
        note: "Unexpected DeFiLlama response format",
      };
    }

    const positions: DefiProtocolPosition[] = json.map((p) => ({
      protocol: p.name ?? "Unknown",
      chain: p.chain ?? "",
      symbol: p.symbol ?? "",
      usdValue: p.usd_value ?? 0,
      type: p.category ?? "defi",
    }));

    const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);

    return {
      address,
      totalUsd,
      positions,
      available: positions.length > 0,
      note: positions.length === 0 ? "No indexed DeFi positions found" : undefined,
    };
  } catch {
    return {
      address,
      totalUsd: 0,
      positions: [],
      available: false,
      note: "DeFiLlama request failed",
    };
  }
}

export async function fetchProtocolTvl(protocol: string): Promise<{ tvl: number; available: boolean }> {
  const base = loadDefiLlamaBaseUrl();
  try {
    const res = await fetch(`${base}/protocol/${protocol.toLowerCase()}`);
    if (!res.ok) return { tvl: 0, available: false };
    const json = (await res.json()) as { tvl?: number[] | number };
    const tvl = Array.isArray(json.tvl) ? json.tvl[json.tvl.length - 1] ?? 0 : (json.tvl ?? 0);
    return { tvl: typeof tvl === "number" ? tvl : 0, available: true };
  } catch {
    return { tvl: 0, available: false };
  }
}
