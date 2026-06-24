import type { LlmConfig } from "./llm-config.js";
import { loadLlmRequestTimeoutMs } from "./llm-config.js";

export type LlmStreamChunk =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string };

export type StreamedChatResult = {
  content: string | null;
  reasoning: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type StreamDelta = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
};

function mergeToolCallDelta(
  acc: Map<
    number,
    { id: string; type: "function"; function: { name: string; arguments: string } }
  >,
  delta: NonNullable<StreamDelta["tool_calls"]>[number],
): void {
  const index = delta.index ?? 0;
  let existing = acc.get(index);
  if (!existing) {
    existing = {
      id: delta.id ?? "",
      type: "function",
      function: { name: "", arguments: "" },
    };
    acc.set(index, existing);
  }
  if (delta.id) existing.id = delta.id;
  if (delta.function?.name) existing.function.name += delta.function.name;
  if (delta.function?.arguments) existing.function.arguments += delta.function.arguments;
}

function extractReasoningChunk(delta: StreamDelta): string | null {
  const raw = delta.reasoning_content ?? delta.reasoning;
  if (typeof raw !== "string" || !raw) return null;
  return raw;
}

/** Stream OpenAI-compatible chat completions; yields content and reasoning deltas. */
export async function* streamOpenAiChatCompletion(
  config: LlmConfig,
  body: Record<string, unknown>,
): AsyncGenerator<LlmStreamChunk, StreamedChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), loadLlmRequestTimeoutMs());

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ ...body, stream: true }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`LLM stream failed (${response.status}): ${errBody.slice(0, 300)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM stream: empty response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  const toolAcc = new Map<
    number,
    { id: string; type: "function"; function: { name: string; arguments: string } }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed: { choices?: Array<{ delta?: StreamDelta }> };
      try {
        parsed = JSON.parse(payload) as { choices?: Array<{ delta?: StreamDelta }> };
      } catch {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      const reasoningChunk = extractReasoningChunk(delta);
      if (reasoningChunk) {
        reasoning += reasoningChunk;
        yield { type: "reasoning", text: reasoningChunk };
      }

      if (delta.content) {
        content += delta.content;
        yield { type: "content", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          mergeToolCallDelta(toolAcc, tc);
        }
      }
    }
  }

  const tool_calls = toolAcc.size > 0 ? [...toolAcc.values()] : undefined;
  return {
    content: content || null,
    reasoning: reasoning || null,
    tool_calls,
  };
}
