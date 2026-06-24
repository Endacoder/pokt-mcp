import type { AgentEvent } from "./types.js";

/** Always streamed for SSE keepalive through proxies; UI may hide when thinking panel is off. */
export function* yieldStatus(message: string, phase: string): Generator<AgentEvent, void, unknown> {
  yield { type: "status", data: { message, phase } };
}
