import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo } from "@pokt-mcp/pocket-client";
import { listMethodsForProtocol } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { asToolServer, chainNotFound, READ_ONLY_ANNOTATION, textResult } from "./helpers.js";

interface DiscoveryDeps {
  listChains: () => ChainInfo[];
  resolveChain: (alias: string) => ChainInfo | undefined;
  getRegistrySource?: () => "bundled" | "remote";
}

export function registerDiscoveryTools(server: McpServer, deps: DiscoveryDeps) {
  const s = asToolServer(server);
  s.tool(
    "pocket_list_chains",
    "List all blockchain networks available via Pocket Network portal",
    {},
    async () => textResult({ chains: deps.listChains(), source: deps.getRegistrySource?.() }),
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_get_chain",
    "Get metadata for a single chain by slug or alias",
    { chain: z.string().describe("Chain slug or alias (e.g. eth, polygon, 137)") },
    async ({ chain }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);
      return textResult(info);
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_list_methods",
    "List common RPC methods for a chain's protocol",
    { chain: z.string() },
    async ({ chain }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const methods = listMethodsForProtocol(info.protocol);

      return textResult({ protocol: info.protocol, methods });
    },
    READ_ONLY_ANNOTATION,
  );
}
