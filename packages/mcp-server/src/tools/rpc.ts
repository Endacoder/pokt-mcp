import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo, PocketClient } from "@pokt-mcp/pocket-client";
import { enrichTxLookupOutput } from "@pokt-mcp/nl-rpc";
import { z } from "zod";
import { loadPolicyConfig, assertMethodAllowed } from "../middleware/policy.js";
import { asToolServer, chainNotFound, textResult } from "./helpers.js";

interface RpcToolDeps {
  pocket: PocketClient;
  resolveChain: (alias: string) => ChainInfo | undefined;
}

export function registerRpcTools(server: McpServer, deps: RpcToolDeps) {
  const policy = loadPolicyConfig();
  const s = asToolServer(server);

  s.tool(
    "pocket_rpc_call",
    "Advanced escape hatch — execute JSON-RPC only when pocket_query fails and you know the exact method + params.",
    {
      chain: z.string().describe("Chain slug or alias"),
      method: z.string().describe("JSON-RPC method name"),
      params: z.array(z.unknown()).optional().default([]),
    },
    async ({ chain, method, params }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      try {
        assertMethodAllowed(policy, method);
        const resp = await deps.pocket.rpc(info.slug, method, params);
        return textResult(
          enrichTxLookupOutput(method, info.slug, params, { result: resp.result, meta: resp.meta }),
        );
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
        for (const call of calls) {
          assertMethodAllowed(policy, call.method);
        }
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
