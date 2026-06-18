import type { ChainInfo } from "@pokt-mcp/shared";
import chains from "./chains.json" with { type: "json" };

const PORTAL_BASE = process.env.POCKET_PORTAL_BASE ?? "https://api.pocket.network";

function buildEndpoint(slug: string): string {
  return `https://${slug}.${PORTAL_BASE.replace(/^https?:\/\//, "")}`;
}

const registry: ChainInfo[] = (chains as Omit<ChainInfo, "endpoint">[]).map((c) => ({
  ...c,
  endpoint: buildEndpoint(c.slug),
}));

const bySlug = new Map(registry.map((c) => [c.slug, c]));
const byAlias = new Map<string, ChainInfo>();

for (const chain of registry) {
  byAlias.set(chain.slug.toLowerCase(), chain);
  for (const alias of chain.aliases) {
    byAlias.set(alias.toLowerCase(), chain);
  }
  if (chain.chainId !== undefined) {
    byAlias.set(String(chain.chainId), chain);
  }
}

export function listChains(): ChainInfo[] {
  return [...registry];
}

export function getChain(slug: string): ChainInfo | undefined {
  return bySlug.get(slug);
}

export function resolveChain(alias: string): ChainInfo | undefined {
  return byAlias.get(alias.toLowerCase());
}

export { registry as chains };
