import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NlRpcEngine } from "@pokt-mcp/nl-rpc";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { textResult } from "./helpers.js";

interface NlToolDeps {
  nlRpc: NlRpcEngine;
  pocket: PocketClient;
}

export function registerNlTools(server: McpServer, deps: NlToolDeps) {
  server.tool(
    "pocket_query_nl",
    "Parse a natural language blockchain query and execute read intents or prepare write intents for confirmation",
    {
      query: z.string().describe("Natural language query, e.g. 'latest block on Base'"),
      chain: z.string().optional().describe("Override chain inference"),
      autoExecute: z.boolean().optional().default(true),
    },
    async ({ query, chain, autoExecute }) => {
      try {
        const parsed = await deps.nlRpc.parse(query, { defaultChain: chain });

        if (parsed.requiresConfirmation || parsed.intent.action === "write") {
          return textResult({
            intent: parsed.intent,
            pendingAction: parsed.pendingAction,
            requiresConfirmation: true,
            message: "Use wallet_send_transaction with confirm:true after user approval",
          });
        }

        if (!autoExecute) {
          return textResult({ intent: parsed.intent });
        }

        const resp = await deps.pocket.rpc(
          parsed.intent.chain,
          parsed.intent.method,
          parsed.intent.params,
        );

        return textResult({ intent: parsed.intent, result: resp.result, meta: resp.meta });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  server.tool(
    "pocket_explain_rpc",
    "Explain what an RPC call would do without executing it",
    {
      chain: z.string(),
      method: z.string(),
      params: z.array(z.unknown()).optional().default([]),
    },
    async ({ chain, method, params }) => {
      const explanation = deps.nlRpc.explain(method, params, chain);
      const isWrite =
        method.includes("send") || method.startsWith("personal_") || method === "eth_sendTransaction";

      return textResult({
        explanation,
        riskLevel: isWrite ? "high" : "none",
      });
    },
  );
}
