import type { ChainInfo, ChainProtocol, ChainStatus } from "@pokt-mcp/shared";

const FETCH_TIMEOUT_MS = 5_000;

type ProbeConfig =
  | { kind: "jsonrpc"; method: string; params?: unknown[] }
  | { kind: "get"; path: string }
  | { kind: "post"; path: string; body?: string };

const PROBE_BY_PROTOCOL: Partial<Record<ChainProtocol, ProbeConfig>> = {
  evm: { kind: "jsonrpc", method: "eth_chainId", params: [] },
  solana: { kind: "jsonrpc", method: "getBlockHeight", params: [] },
  cosmos: { kind: "get", path: "/cosmos/base/tendermint/v1beta1/blocks/latest" },
  sui: { kind: "jsonrpc", method: "sui_getLatestCheckpointSequenceNumber", params: [] },
  near: { kind: "jsonrpc", method: "status", params: [] },
  tron: { kind: "jsonrpc", method: "eth_chainId", params: [] },
};

async function probeChain(chain: ChainInfo, config: ProbeConfig): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    if (config.kind === "get") {
      const response = await fetch(`${chain.endpoint}${config.path}`, { signal: controller.signal });
      return response.ok;
    }

    if (config.kind === "post") {
      const response = await fetch(`${chain.endpoint}${config.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: config.body ?? "{}",
        signal: controller.signal,
      });
      return response.ok;
    }

    const response = await fetch(chain.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: config.method,
        params: config.params ?? [],
        id: 1,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const json = (await response.json()) as { error?: unknown };
    return !json.error;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type StatusUpdater = (slug: string, status: ChainStatus) => void;

export async function runLivenessProbes(
  chains: ChainInfo[],
  updateStatus: StatusUpdater,
): Promise<void> {
  if (process.env.ENABLE_LIVENESS_PROBES === "false") return;

  const probeTargets: ChainInfo[] = [];
  for (const protocol of Object.keys(PROBE_BY_PROTOCOL) as ChainProtocol[]) {
    const candidate = chains.find(
      (chain) =>
        chain.protocol === protocol &&
        chain.network === "mainnet" &&
        chain.status !== "inactive",
    );
    if (candidate) probeTargets.push(candidate);
  }

  const results = await Promise.all(
    probeTargets.map(async (chain) => {
      const config = PROBE_BY_PROTOCOL[chain.protocol];
      if (!config) return { protocol: chain.protocol, ok: true };
      const ok = await probeChain(chain, config);
      return { protocol: chain.protocol, ok };
    }),
  );

  const failedProtocols = new Set(
    results.filter((result) => !result.ok).map((result) => result.protocol),
  );

  for (const chain of chains) {
    if (failedProtocols.has(chain.protocol) && chain.status !== "inactive") {
      updateStatus(chain.slug, "degraded");
    }
  }
}
