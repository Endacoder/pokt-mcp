import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo, PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { asToolServer, chainNotFound, textResult } from "./helpers.js";

interface RpcToolDeps {
  pocket: PocketClient;
  resolveChain: (alias: string) => ChainInfo | undefined;
}

export function registerRpcTools(server: McpServer, deps: RpcToolDeps) {
  const s = asToolServer(server);
  s.tool(
    "pocket_rpc_call",
    "Execute any JSON-RPC method on a Pocket Network chain. Full RPC escape hatch for reads and non-wallet writes.",
    {
      chain: z.string().describe("Chain slug or alias"),
      method: z.string().describe("JSON-RPC method name"),
      params: z.array(z.unknown()).optional().default([]),
    },
    async ({ chain, method, params }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      try {
        const resp = await deps.pocket.rpc(info.slug, method, params);
        return textResult({ result: resp.result, meta: resp.meta });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  s.tool(
    "pocket_batch_rpc",
    "Execute multiple JSON-RPC calls in one batch (read-only)",
    {
      chain: z.string(),
      calls: z.array(
        z.object({
          method: z.string(),
          params: z.array(z.unknown()).optional(),
        }),
      ),
    },
    async ({ chain, calls }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      try {
        const results = await deps.pocket.batch(
          info.slug,
          calls.map((c: { method: string; params?: unknown[] }) => ({ method: c.method, params: c.params ?? [] })),
        );
        return textResult({ results });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );
}
