import type { RpcIntent } from "@pokt-mcp/shared";
import { resolveChain, type ChainInfo } from "@pokt-mcp/pocket-client";
import { intent } from "./patterns.js";

/** EVM (and Tron) chains expose chain ID via eth_chainId JSON-RPC. */
export function usesEvmChainIdRpc(chain: string): boolean {
  const info = resolveChain(chain);
  if (!info) return true;
  return info.protocol === "evm" || info.protocol === "tron";
}

export function chainIdIntent(chain: string): RpcIntent {
  if (usesEvmChainIdRpc(chain)) {
    return intent(chain, "eth_chainId", [], `Get chain ID for ${chain}`);
  }
  return intent(chain, "__get_chain__", [chain], `Get chain metadata for ${chain}`);
}

export function chainMetadataIntent(chain: string): RpcIntent {
  return intent(chain, "__get_chain__", [chain], `Get chain metadata for ${chain}`);
}

export function executeGetChain(slug: string): { chain: ChainInfo } {
  const info = resolveChain(slug);
  if (!info) {
    throw new Error(`CHAIN_NOT_FOUND: unknown chain "${slug}"`);
  }
  return { chain: info };
}

export function formatGetChain(result: { chain: ChainInfo }): string {
  const c = result.chain;
  const parts = [
    `${c.name} (${c.slug})`,
    `protocol: ${c.protocol}`,
    `network: ${c.network ?? "mainnet"}`,
    `native: ${c.nativeSymbol}`,
  ];
  if (c.chainId != null) {
    parts.push(`chain ID: ${c.chainId}`);
  } else if (c.protocol !== "evm" && c.protocol !== "tron") {
    parts.push("no EVM chain ID (non-EVM chain — use protocol-specific RPC)");
  }
  return `\n${parts.join(" · ")}`;
}
