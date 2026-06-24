import type { LlmStreamCallbacks } from "@pokt-mcp/shared";
import type { AgentEvent } from "./types.js";

/** Run an async task and yield reasoning SSE events as the LLM emits them. */
export async function* runWithReasoningStream<T>(
  run: (callbacks?: LlmStreamCallbacks) => Promise<T>,
): AsyncGenerator<AgentEvent, T> {
  const pending: string[] = [];
  let resolveWait: (() => void) | null = null;

  const task = run({
    onReasoning: (text) => {
      pending.push(text);
      resolveWait?.();
      resolveWait = null;
    },
  });

  while (true) {
    while (pending.length > 0) {
      yield { type: "reasoning", data: { text: pending.shift()! } };
    }

    const settled = await Promise.race([
      task.then((result) => ({ done: true as const, result })),
      new Promise<{ done: false }>((resolve) => {
        resolveWait = () => resolve({ done: false });
      }),
    ]);

    if (settled.done) {
      while (pending.length > 0) {
        yield { type: "reasoning", data: { text: pending.shift()! } };
      }
      return settled.result;
    }
  }
}
