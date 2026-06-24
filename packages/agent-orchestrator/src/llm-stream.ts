import type { LlmConfig } from "@pokt-mcp/shared";
import { streamOpenAiChatCompletion } from "@pokt-mcp/shared";
import type { AgentEvent } from "./types.js";

export type StreamedLlmResult = {
  content: string | null;
  reasoning: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

/** Map shared LLM stream chunks to agent SSE events. */
export async function* streamChatCompletion(
  config: LlmConfig,
  body: Record<string, unknown>,
): AsyncGenerator<AgentEvent, StreamedLlmResult> {
  const stream = streamOpenAiChatCompletion(config, body);
  let result: StreamedLlmResult | undefined;

  while (true) {
    const step = await stream.next();
    if (step.done) {
      result = {
        content: step.value.content,
        reasoning: step.value.reasoning,
        tool_calls: step.value.tool_calls,
      };
      break;
    }
    if (step.value.type === "reasoning") {
      yield { type: "reasoning", data: { text: step.value.text } };
    } else {
      yield { type: "token", data: { text: step.value.text } };
    }
  }

  return result!;
}
