import { createNlRpcEngine, formatKnownTokensForPrompt } from "@pokt-mcp/nl-rpc";
import {
  createPocketClient,
  listChains,
  listMethodsForProtocol,
  resolveChain,
  type PocketClient,
} from "@pokt-mcp/pocket-client";
import type { ChatHistoryMessage, LlmConfig, SessionContext } from "@pokt-mcp/shared";
import { isWriteRpcMethod, loadAgentMaxSteps, loadLlmConfig, prepareSanitizedQueryInput } from "@pokt-mcp/shared";
import type { AgentEvent } from "./types.js";
import { isSwapQuery } from "./complexity.js";
import { assertAgentMethodAllowed, isAgentWriteMethod, loadAgentPolicyConfig } from "./policy.js";
import { yieldStatus } from "./status-events.js";
import { streamChatCompletion, type StreamedLlmResult } from "./llm-stream.js";

const AGENT_SYSTEM_PROMPT = `You are a blockchain research agent with access to Pocket Network RPC tools.
Answer the user's query by calling tools. Prefer read-only RPC calls.
Never ask for private keys. For send/transfer/write operations, explain what would be needed but do not execute writes.
When you have enough data, respond with a concise human-readable answer.
Use chain slugs from list_chains. For EVM token balances, use eth_call with balanceOf calldata when needed.
For event history use eth_getLogs.
If rpc_call fails with RPC_ERROR, fix params and retry or call list_methods first.
NEVER invent RPC methods (eth_getTransactionByAddress does not exist). NEVER describe hypothetical tool calls — always execute rpc_call or other tools and summarize real results.
NEVER suggest third-party RPC providers (Alchemy, Infura, etc.) — all reads go through Pocket Network via rpc_call.
For wallet transaction history, use eth_getBlockByNumber with full txs or eth_getLogs — there is no single "get transactions by address" RPC method.
NEVER provide manual DEX/swap/trade instructions (Uniswap routers, pair reserves, swap calldata). Token swaps are handled by Intent MCP — tell the user to ask for a swap quote instead.

Known token contracts:
${formatKnownTokensForPrompt()}`;

const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_chains",
      description: "List all Pocket Network chains with slug, name, and protocol",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_chain",
      description: "Get metadata for a chain by slug or alias",
      parameters: {
        type: "object",
        properties: { chain: { type: "string", description: "Chain slug or alias" } },
        required: ["chain"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_methods",
      description: "List common RPC methods for a chain's protocol",
      parameters: {
        type: "object",
        properties: { chain: { type: "string" } },
        required: ["chain"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "rpc_call",
      description: "Execute a JSON-RPC read call on a chain",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string" },
          method: { type: "string" },
          params: { type: "array", items: {} },
        },
        required: ["chain", "method"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "explain_rpc",
      description: "Explain what an RPC call would do without executing",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string" },
          method: { type: "string" },
          params: { type: "array", items: {} },
        },
        required: ["chain", "method"],
      },
    },
  },
];

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentLoopInput {
  query: string;
  history?: ChatHistoryMessage[];
  sessionContext: SessionContext;
  maxSteps?: number;
  llmConfig?: LlmConfig | null;
  pocket?: PocketClient;
}

const MAX_AGENT_HISTORY_MESSAGES = 20;
const MAX_AGENT_HISTORY_CONTENT = 800;

function truncateHistoryContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_AGENT_HISTORY_CONTENT) return trimmed;
  return `${trimmed.slice(0, MAX_AGENT_HISTORY_CONTENT)}…`;
}

function buildAgentHistoryMessages(history?: ChatHistoryMessage[]): ChatMessage[] {
  if (!history?.length) return [];
  const capped = history.length > MAX_AGENT_HISTORY_MESSAGES
    ? history.slice(-MAX_AGENT_HISTORY_MESSAGES)
    : history;
  return capped.map((msg) => ({
    role: msg.role,
    content: truncateHistoryContent(msg.content),
  }));
}

export interface AgentLoopDeps {
  pocket: PocketClient;
  llmConfig: LlmConfig;
  nlRpc: ReturnType<typeof createNlRpcEngine>;
  policy: ReturnType<typeof loadAgentPolicyConfig>;
}

function formatSessionBlock(context: SessionContext): string {
  const parts: string[] = [];
  if (context.defaultChain) parts.push(`Default chain: ${context.defaultChain}`);
  if (context.connectedAddress) parts.push(`Connected wallet: ${context.connectedAddress}`);
  if (context.lastBalance) {
    parts.push(`Last balance: ${context.lastBalance.address} on ${context.lastBalance.chain}`);
  }
  if (context.lastQuery) {
    parts.push(`Last query: ${context.lastQuery.method} on ${context.lastQuery.chain}`);
  }
  return parts.length ? `\n${parts.join("\n")}` : "";
}

async function executeAgentTool(
  deps: AgentLoopDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: unknown; isWrite?: boolean }> {
  switch (name) {
    case "list_chains":
      return { result: { chains: listChains() } };

    case "get_chain": {
      const chain = String(args.chain ?? "");
      const info = resolveChain(chain);
      if (!info) return { result: { error: `Unknown chain: ${chain}` } };
      return { result: info };
    }

    case "list_methods": {
      const chain = String(args.chain ?? "");
      const info = resolveChain(chain);
      if (!info) return { result: { error: `Unknown chain: ${chain}` } };
      return { result: { protocol: info.protocol, methods: listMethodsForProtocol(info.protocol) } };
    }

    case "explain_rpc": {
      const chain = String(args.chain ?? "");
      const method = String(args.method ?? "");
      const params = (args.params as unknown[]) ?? [];
      return { result: { explanation: deps.nlRpc.explain(method, params, chain) } };
    }

    case "rpc_call": {
      const chain = String(args.chain ?? "");
      const method = String(args.method ?? "");
      const params = (args.params as unknown[]) ?? [];
      const info = resolveChain(chain);
      if (!info) return { result: { error: `Unknown chain: ${chain}` } };

      if (isAgentWriteMethod(method) || isWriteRpcMethod(method)) {
        return {
          result: {
            requiresConfirmation: true,
            message: "Write RPC methods require wallet confirmation — use wallet_send_transaction",
            chain: info.slug,
            method,
            params,
          },
          isWrite: true,
        };
      }

      assertAgentMethodAllowed(deps.policy, method);
      const resp = await deps.pocket.rpc(info.slug, method, params);
      return { result: { result: resp.result, meta: resp.meta } };
    }

    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

export function createAgentLoopDeps(overrides?: Partial<AgentLoopDeps>): AgentLoopDeps {
  const llmConfig = overrides?.llmConfig ?? loadLlmConfig();
  if (!llmConfig?.enabled) {
    throw new Error("Agent loop requires LLM configuration (FEATURE_NL_LLM=true and valid LLM_MODEL/API keys)");
  }
  return {
    pocket: overrides?.pocket ?? createPocketClient(),
    llmConfig,
    nlRpc: overrides?.nlRpc ?? createNlRpcEngine({ llm: llmConfig }),
    policy: overrides?.policy ?? loadAgentPolicyConfig(),
  };
}

export async function* runAgentLoop(input: AgentLoopInput): AsyncGenerator<AgentEvent> {
  const deps = createAgentLoopDeps({
    ...(input.pocket ? { pocket: input.pocket } : {}),
    ...(input.llmConfig ? { llmConfig: input.llmConfig } : {}),
  });

  const sanitized = prepareSanitizedQueryInput({
    query: input.query,
    history: input.history,
    sessionContext: input.sessionContext,
  });

  if (isSwapQuery(sanitized.query)) {
    yield {
      type: "error",
      data: {
        message:
          "Token swaps are handled by the swap quote flow, not manual RPC. Rephrase as: swap 1 USDT to WETH",
        code: "SWAP_USE_INTENT_MCP",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const maxSteps = input.maxSteps ?? loadAgentMaxSteps();
  const steps: Array<{ tool: string; args: unknown; result: unknown }> = [];

  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...buildAgentHistoryMessages(sanitized.history),
    {
      role: "user",
      content: `${sanitized.query}${formatSessionBlock(sanitized.sessionContext ?? input.sessionContext)}`,
    },
  ];

  try {
    for (let step = 0; step < maxSteps; step++) {
      yield* yieldStatus(`Thinking (step ${step + 1}/${maxSteps})…`, "agent");

      const stream = streamChatCompletion(deps.llmConfig, {
        model: deps.llmConfig.model,
        messages,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        temperature: 0,
        max_tokens: 1024,
      });

      let llmResponse: StreamedLlmResult | undefined;
      let streamedText = false;
      while (true) {
        const step = await stream.next();
        if (step.done) {
          llmResponse = step.value;
          break;
        }
        if (step.value.type === "token") streamedText = true;
        yield step.value;
      }

      if (!llmResponse) {
        throw new Error("Agent LLM stream ended without a result");
      }

      const llmResponseNormalized = {
        content: llmResponse.content,
        tool_calls: llmResponse.tool_calls,
      };

      if (llmResponseNormalized.tool_calls?.length) {
        messages.push({
          role: "assistant",
          content: llmResponseNormalized.content,
          tool_calls: llmResponseNormalized.tool_calls,
        });

        for (const toolCall of llmResponseNormalized.tool_calls) {
          const toolName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }

          yield* yieldStatus(`Calling ${toolName}…`, "tool");
          yield {
            type: "tool",
            data: { tool: toolName, args, input: args, status: "running" },
          };

          const toolStart = Date.now();
          const { result, isWrite } = await executeAgentTool(deps, toolName, args);
          steps.push({ tool: toolName, args, result });

          yield {
            type: "tool",
            data: {
              tool: toolName,
              args,
              input: args,
              status: "done",
              output: result,
              latencyMs: Date.now() - toolStart,
            },
          };

          if (isWrite) {
            yield {
              type: "result",
              data: {
                route: "agent",
                requiresConfirmation: true,
                steps,
                message: "Write operation detected — requires wallet confirmation",
                pending: result,
              },
            };
            yield { type: "done", data: {} };
            return;
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      if (steps.length === 0 && step < maxSteps - 1) {
        messages.push({
          role: "assistant",
          content: llmResponseNormalized.content,
        });
        messages.push({
          role: "user",
          content:
            "You must call tools to answer — do not describe hypothetical RPC methods or JSON payloads. Execute rpc_call or other available tools now, then summarize the real results.",
        });
        continue;
      }

      const answer = llmResponseNormalized.content?.trim() || "Completed query.";
      yield {
        type: "result",
        data: { route: "agent", steps, answer },
      };
      if (!streamedText) {
        yield { type: "token", data: { text: `\n${answer}` } };
      }
      yield { type: "done", data: {} };
      return;
    }

    yield {
      type: "error",
      data: { message: `Agent loop reached max steps (${maxSteps}) without a final answer`, steps },
    };
  } catch (err) {
    yield {
      type: "error",
      data: { message: err instanceof Error ? err.message : String(err), steps },
    };
  }

  yield { type: "done", data: {} };
}

/** Collect agent loop events into a single result (for MCP tool responses). */
export async function collectAgentLoopResult(input: AgentLoopInput): Promise<{
  steps: Array<{ tool: string; args: unknown; result: unknown }>;
  answer?: string;
  error?: string;
  requiresConfirmation?: boolean;
}> {
  const steps: Array<{ tool: string; args: unknown; result: unknown }> = [];
  let answer: string | undefined;
  let error: string | undefined;
  let requiresConfirmation = false;

  for await (const event of runAgentLoop(input)) {
    if (event.type === "tool") {
      const data = event.data as { tool: string; args: unknown };
      // step result appended on next result-bearing events via runAgentLoop steps
    }
    if (event.type === "result") {
      const data = event.data as {
        steps?: Array<{ tool: string; args: unknown; result: unknown }>;
        answer?: string;
        requiresConfirmation?: boolean;
      };
      if (data.steps) steps.push(...data.steps);
      if (data.answer) answer = data.answer;
      if (data.requiresConfirmation) requiresConfirmation = true;
    }
    if (event.type === "error") {
      const data = event.data as { message: string; steps?: Array<{ tool: string; args: unknown; result: unknown }> };
      error = data.message;
      if (data.steps) steps.push(...data.steps);
    }
  }

  return { steps, answer, error, requiresConfirmation };
}
