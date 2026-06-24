import type { ChainInfo, ChainProtocol, ChainStatus } from "@pokt-mcp/shared";
import bundledChains from "./chains.json" with { type: "json" };

export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/pokt-network/public-rpc/main/supported-chains.json";

const FETCH_TIMEOUT_MS = 5_000;

const NATIVE_SYMBOL_BY_SLUG: Record<string, string> = {
  poly: "POL",
  avax: "AVAX",
  bsc: "BNB",
  gnosis: "xDAI",
  celo: "CELO",
  fantom: "FTM",
  moonbeam: "GLMR",
  moonriver: "MOVR",
  kava: "KAVA",
  bera: "BERA",
  metis: "METIS",
  mantle: "MNT",
  kaia: "KAIA",
  iotex: "IOTX",
  sei: "SEI",
  sonic: "S",
  tron: "TRX",
  solana: "SOL",
  sui: "SUI",
  near: "NEAR",
  osmosis: "OSMO",
  akash: "AKT",
  juno: "JUNO",
  pocket: "POKT",
};

const NATIVE_SYMBOL_BY_PROTOCOL: Record<ChainProtocol, string> = {
  evm: "ETH",
  solana: "SOL",
  cosmos: "ATOM",
  sui: "SUI",
  near: "NEAR",
  tron: "TRX",
};

type RemoteChainEntry = {
  name: string;
  slug: string;
  protocol: string;
  url: string;
  network: string;
  chainId?: number;
  status?: string;
};

type RemoteRegistry = {
  chains: RemoteChainEntry[];
};

type BundledEntry = Omit<ChainInfo, "endpoint" | "status"> & { portalSlug?: string };

function normalizeProtocol(raw: string): ChainProtocol {
  switch (raw) {
    case "evm":
    case "solana":
    case "cosmos":
    case "sui":
    case "near":
    case "tron":
      return raw;
    default:
      return "evm";
  }
}

function inferNativeSymbol(slug: string, protocol: ChainProtocol, name: string): string {
  return NATIVE_SYMBOL_BY_SLUG[slug] ?? NATIVE_SYMBOL_BY_PROTOCOL[protocol] ?? name.split(/\s+/)[0]?.toUpperCase() ?? slug.toUpperCase();
}

function hostSlugFromUrl(url: string): string | undefined {
  const match = url.match(/^https?:\/\/([^.]+)\./);
  return match?.[1];
}

function buildOverrideMaps(entries: BundledEntry[]) {
  const bySlug = new Map<string, BundledEntry>();
  const byPortalSlug = new Map<string, BundledEntry>();
  for (const entry of entries) {
    bySlug.set(entry.slug, entry);
    if (entry.portalSlug) {
      byPortalSlug.set(entry.portalSlug, entry);
    }
  }
  return { bySlug, byPortalSlug };
}

function findBundledOverride(
  remote: RemoteChainEntry,
  maps: ReturnType<typeof buildOverrideMaps>,
): BundledEntry | undefined {
  return (
    maps.bySlug.get(remote.slug) ??
    maps.byPortalSlug.get(remote.slug) ??
    (() => {
      const host = hostSlugFromUrl(remote.url);
      return host ? maps.byPortalSlug.get(host) ?? maps.bySlug.get(host) : undefined;
    })()
  );
}

function mergeRemoteChain(remote: RemoteChainEntry, override?: BundledEntry): ChainInfo {
  const protocol = normalizeProtocol(remote.protocol);
  const slug = override?.slug ?? remote.slug;
  const endpoint = remote.url;
  const hostSlug = hostSlugFromUrl(endpoint);
  const portalSlug =
    override?.portalSlug ?? (hostSlug && hostSlug !== slug ? hostSlug : undefined);

  const aliases = new Set<string>([
    slug,
    remote.slug,
    ...(override?.aliases ?? []),
    remote.name.toLowerCase().replace(/\s+/g, "-"),
  ]);
  if (portalSlug) aliases.add(portalSlug);
  if (override?.slug && override.slug !== remote.slug) aliases.add(override.slug);

  const chainId = override?.chainId ?? remote.chainId;
  if (chainId !== undefined) aliases.add(String(chainId));

  const testnet = override?.testnet ?? remote.network === "testnet";
  const status: ChainStatus =
    remote.status === "inactive" ? "inactive" : remote.status === "degraded" ? "degraded" : "active";

  return {
    slug,
    name: override?.name ?? remote.name,
    chainId,
    nativeSymbol: override?.nativeSymbol ?? inferNativeSymbol(slug, protocol, remote.name),
    protocol,
    endpoint,
    portalSlug,
    aliases: [...aliases].filter(Boolean),
    blockExplorer: override?.blockExplorer,
    testnet,
    network: remote.network === "testnet" ? "testnet" : "mainnet",
    status,
  };
}

export function loadBundledRegistry(): ChainInfo[] {
  const PORTAL_BASE = process.env.POCKET_PORTAL_BASE ?? "https://api.pocket.network";
  const hostBase = PORTAL_BASE.replace(/^https?:\/\//, "");

  return (bundledChains as BundledEntry[]).map((entry) => {
    const hostSlug = entry.portalSlug ?? entry.slug;
    return {
      ...entry,
      endpoint: `https://${hostSlug}.${hostBase}`,
      network: entry.testnet ? "testnet" : "mainnet",
      status: "active" as const,
    };
  });
}

export async function loadRemoteRegistry(url = process.env.CHAIN_REGISTRY_URL?.trim() || DEFAULT_REGISTRY_URL): Promise<ChainInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Registry fetch failed: HTTP ${response.status}`);
    }
    const registry = (await response.json()) as RemoteRegistry;
    const overrideMaps = buildOverrideMaps(bundledChains as BundledEntry[]);
    return registry.chains.map((remote) => mergeRemoteChain(remote, findBundledOverride(remote, overrideMaps)));
  } finally {
    clearTimeout(timer);
  }
}

export function rebuildAliasIndex(chains: ChainInfo[]) {
  const bySlug = new Map<string, ChainInfo>();
  const byAlias = new Map<string, ChainInfo>();

  for (const chain of chains) {
    bySlug.set(chain.slug, chain);
    byAlias.set(chain.slug.toLowerCase(), chain);
    for (const alias of chain.aliases) {
      byAlias.set(alias.toLowerCase(), chain);
    }
    if (chain.chainId !== undefined) {
      byAlias.set(String(chain.chainId), chain);
    }
  }

  return { bySlug, byAlias };
}
