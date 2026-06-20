import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collectAgentLoopResult } from "@pokt-mcp/agent-orchestrator";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { isAgentLoopEnabled } from "@pokt-mcp/shared";
import { z } from "zod";
import { getMcpSession, mergeMcpSession } from "../session.js";
import { asToolServer, textResult } from "./helpers.js";

interface AgentToolDeps {
  pocket: PocketClient;
}

export function registerAgentTools(server: McpServer, deps: AgentToolDeps) {
  const s = asToolServer(server);

  s.tool(
    "pocket_agent_query",
    "Run a multi-step agent for complex blockchain queries. Prefer pocket_query — use this only when you need explicit multi-step control.",
    {
      query: z.string().describe("Natural language query"),
      chain: z.string().optional().describe("Default chain slug"),
      sessionId: z.string().optional().describe("Session ID for follow-up context"),
      maxSteps: z.number().optional().describe("Max tool-call steps (default from AGENT_MAX_STEPS)"),
    },
    async ({ query, chain, sessionId, maxSteps }) => {
      if (!isAgentLoopEnabled()) {
        return textResult(
          {
            error: "Agent loop disabled. Set FEATURE_AGENT_LOOP=true and configure LLM.",
          },
          true,
        );
      }

      try {
        const sessionContext = mergeMcpSession(sessionId, {
          defaultChain: chain,
          ...(sessionId ? getMcpSession(sessionId) : {}),
        });

        const result = await collectAgentLoopResult({
          query,
          sessionContext,
          maxSteps,
          pocket: deps.pocket,
        });

        if (result.error) {
          return textResult({ error: result.error, steps: result.steps, suggestAgent: false }, true);
        }

        if (result.requiresConfirmation) {
          return textResult({
            requiresConfirmation: true,
            steps: result.steps,
            message: "Write operation detected — use wallet_send_transaction after user approval",
          });
        }

        return textResult({
          answer: result.answer,
          steps: result.steps,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );
}
