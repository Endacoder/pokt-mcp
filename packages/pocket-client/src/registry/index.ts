import type { ChainInfo, ChainStatus } from "@pokt-mcp/shared";
import { loadBundledRegistry, loadRemoteRegistry, rebuildAliasIndex } from "./loader.js";
import { runLivenessProbes } from "./liveness.js";

let registry: ChainInfo[] = loadBundledRegistry();
let bySlug = new Map<string, ChainInfo>();
let byAlias = new Map<string, ChainInfo>();
let initPromise: Promise<void> | null = null;
let registrySource: "bundled" | "remote" = "bundled";

function applyIndexes(chains: ChainInfo[]) {
  registry = chains;
  const indexes = rebuildAliasIndex(chains);
  bySlug = indexes.bySlug;
  byAlias = indexes.byAlias;
}

applyIndexes(registry);

function updateChainStatus(slug: string, status: ChainStatus) {
  const chain = bySlug.get(slug);
  if (!chain) return;
  chain.status = status;
}

export function getRegistrySource(): "bundled" | "remote" {
  return registrySource;
}

export async function initRegistry(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const remote = await loadRemoteRegistry();
      applyIndexes(remote);
      registrySource = "remote";
    } catch (err) {
      applyIndexes(loadBundledRegistry());
      registrySource = "bundled";
      console.error(
        "[pocket-client] Remote registry unavailable, using bundled fallback:",
        err instanceof Error ? err.message : String(err),
      );
    }

    void runLivenessProbes(registry, updateChainStatus);
  })();

  return initPromise;
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
