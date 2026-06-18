import { createNlRpcEngine, executeIntent } from "@pokt-mcp/nl-rpc";
import { createPocketClient } from "@pokt-mcp/pocket-client";
import type { ChatRequest } from "@pokt-mcp/shared";

const SYSTEM_PROMPT = `You are a blockchain assistant backed by Pocket Network MCP tools.
Never ask for private keys. For sends, always preview first and require explicit user confirmation.
Prefer natural language chain queries. Use explicit RPC only when needed.`;

export interface AgentEvent {
  type: "token" | "tool" | "result" | "error" | "done";
  data: unknown;
}

export function createAgentOrchestrator() {
  const nlRpc = createNlRpcEngine();
  const pocket = createPocketClient();

  return {
    systemPrompt: SYSTEM_PROMPT,

    async *runChat(input: ChatRequest): AsyncGenerator<AgentEvent> {
      yield { type: "token", data: { text: "Parsing query...\n" } };

      try {
        const parsed = await nlRpc.parse(input.message, { defaultChain: input.chain });

        yield {
          type: "tool",
          data: {
            tool: "pocket_query_nl",
            input: input.message,
            intent: parsed.intent,
          },
        };

        if (parsed.requiresConfirmation) {
          yield {
            type: "result",
            data: {
              requiresConfirmation: true,
              intent: parsed.intent,
              pendingAction: parsed.pendingAction,
              message: "This action requires wallet confirmation. Use the wallet UI to preview and send.",
            },
          };
          yield { type: "done", data: {} };
          return;
        }

        const start = Date.now();
        const output = await executeIntent(pocket, parsed.intent);
        yield {
          type: "result",
          data: {
            intent: parsed.intent,
            output,
            latencyMs: Date.now() - start,
          },
        };
        yield {
          type: "token",
          data: { text: `\n\n${JSON.stringify(output, null, 2)}` },
        };
      } catch (err) {
        yield {
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        };
      }

      yield { type: "done", data: {} };
    },
  };
}
