import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collectRouteQueryResult } from "@pokt-mcp/agent-orchestrator";
import type { NlRpcEngine } from "@pokt-mcp/nl-rpc";
import { executeIntent } from "@pokt-mcp/nl-rpc";
import { isAgentLoopEnabled } from "@pokt-mcp/shared";
import { z } from "zod";
import { getMcpSession, mergeMcpSession, updateMcpSession } from "../session.js";
import { asToolServer, textResult } from "./helpers.js";

interface NlToolDeps {
  nlRpc: NlRpcEngine;
  pocket: import("@pokt-mcp/pocket-client").PocketClient;
}

function rememberBalanceFromOutput(
  sessionId: string | undefined,
  intent: import("@pokt-mcp/shared").RpcIntent,
  output: unknown,
): void {
  if (!sessionId || intent.method !== "eth_getBalance") return;
  const result = (output as { result?: unknown }).result;
  if (typeof result !== "string") return;
  const address = intent.params[0];
  if (typeof address !== "string") return;
  updateMcpSession(sessionId, {
    lastBalance: { chain: intent.chain, address, wei: result },
  });
}

export function registerNlTools(server: McpServer, deps: NlToolDeps) {
  const s = asToolServer(server);
  s.tool(
    "pocket_query_nl",
    "Legacy NL parser — prefer pocket_query. Parses natural language and executes read intents or prepares write intents for confirmation.",
    {
      query: z.string().describe("Natural language query, e.g. 'latest block on Base'"),
      chain: z.string().optional().describe("Override chain inference"),
      sessionId: z.string().optional().describe("Session ID for follow-up context (temporal, balance)"),
      autoExecute: z.boolean().optional().default(true),
    },
    async ({ query, chain, sessionId, autoExecute }) => {
      const sessionContext = mergeMcpSession(sessionId, {
        defaultChain: chain,
        ...(sessionId ? getMcpSession(sessionId) : {}),
      });

      try {
        const parsed = await deps.nlRpc.parse(query, sessionContext);

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
        rememberBalanceFromOutput(sessionId, parsed.intent, output);
        return textResult({ intent: parsed.intent, output, route: "intent" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const canFallback =
          isAgentLoopEnabled() &&
          (message.includes("NL_PARSE_FAILED") ||
            message.includes("RPC_ERROR") ||
            message.includes("CHAIN_NOT_FOUND"));

        if (canFallback) {
          const result = await collectRouteQueryResult({
            query,
            sessionContext,
            pocket: deps.pocket,
            onSessionUpdate: sessionId
              ? (patch) => updateMcpSession(sessionId, patch)
              : undefined,
          });

          if (result.error) {
            return textResult({ error: result.error, suggestAgent: true, fallbackUsed: true }, true);
          }

          return textResult({
            route: result.route ?? "agent",
            answer: result.answer,
            intent: result.intent,
            output: result.output,
            steps: result.steps,
            fallbackUsed: true,
            requiresConfirmation: result.requiresConfirmation,
          });
        }

        return textResult(
          {
            error: message,
            suggestAgent: isAgentLoopEnabled() && message.includes("NL_PARSE_FAILED"),
          },
          true,
        );
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
