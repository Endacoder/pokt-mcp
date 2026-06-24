import type { AgentEvent } from "./types.js";
import { yieldStatus } from "./status-events.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Emit status heartbeats while a long-running task executes (wallet health, audits, etc.). */
export async function* runWithHeartbeat<T>(
  label: string,
  phase: string,
  run: () => Promise<T>,
  heartbeatMs = 2500,
): AsyncGenerator<AgentEvent, T> {
  const start = Date.now();
  let output: T | undefined;
  let error: unknown;
  let settled = false;

  const task = run()
    .then((value) => {
      output = value;
      settled = true;
    })
    .catch((err) => {
      error = err;
      settled = true;
    });

  while (!settled) {
    await Promise.race([task, sleep(heartbeatMs)]);
    if (!settled) {
      const sec = Math.round((Date.now() - start) / 1000);
      yield* yieldStatus(`${label}… (${sec}s)`, phase);
    }
  }

  if (error) throw error;
  return output as T;
}

/** Stream pre-built answer text in small chunks so the UI updates progressively. */
export function* yieldTextChunks(text: string, chunkSize = 32): Generator<AgentEvent> {
  if (!text) return;
  for (let i = 0; i < text.length; i += chunkSize) {
    yield { type: "token", data: { text: text.slice(i, i + chunkSize) } };
  }
}
