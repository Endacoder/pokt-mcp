import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NlRpcEngine } from "@pokt-mcp/nl-rpc";
import { executeIntent } from "@pokt-mcp/nl-rpc";
import { z } from "zod";
import { asToolServer, textResult } from "./helpers.js";

interface NlToolDeps {
  nlRpc: NlRpcEngine;
  pocket: import("@pokt-mcp/pocket-client").PocketClient;
}

export function registerNlTools(server: McpServer, deps: NlToolDeps) {
  const s = asToolServer(server);
  s.tool(
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

        const output = await executeIntent(deps.pocket, parsed.intent);
        return textResult({ intent: parsed.intent, output });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  s.tool(
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
