import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collectRouteQueryResult } from "@pokt-mcp/agent-orchestrator";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { getMcpSession, mergeMcpSession, updateMcpSession } from "../session.js";
import { asToolServer, textResult } from "./helpers.js";

interface QueryToolDeps {
  pocket: PocketClient;
}

export function registerQueryTools(server: McpServer, deps: QueryToolDeps) {
  const s = asToolServer(server);

  s.tool(
    "pocket_query",
    "PRIMARY tool for natural language blockchain questions. Routes dynamically through templates, LLM intent, and multi-step agent as needed.",
    {
      query: z.string().describe("Natural language blockchain query"),
      chain: z.string().optional().describe("Default chain slug"),
      sessionId: z.string().optional().describe("Session ID for follow-up context"),
    },
    async ({ query, chain, sessionId }) => {
      try {
        const sessionContext = mergeMcpSession(sessionId, {
          defaultChain: chain,
          ...(sessionId ? getMcpSession(sessionId) : {}),
        });

        const result = await collectRouteQueryResult({
          query,
          sessionContext,
          pocket: deps.pocket,
          onSessionUpdate: sessionId
            ? (patch) => updateMcpSession(sessionId, patch)
            : undefined,
        });

        if (result.error) {
          return textResult({ error: result.error, route: result.route, steps: result.steps }, true);
        }

        if (result.requiresConfirmation) {
          return textResult({
            route: result.route,
            requiresConfirmation: true,
            steps: result.steps,
            intent: result.intent,
            message: "Write operation requires wallet confirmation",
          });
        }

        return textResult({
          route: result.route,
          /** Primary user-facing text — use this when replying to the user. */
          answer: result.answer,
          naturalLanguageSummary: result.answer,
          intent: result.intent,
          output: result.output,
          steps: result.steps,
          fallbackUsed: result.fallbackUsed,
          interpretationContext: (result as { interpretationContext?: unknown }).interpretationContext,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );
}
