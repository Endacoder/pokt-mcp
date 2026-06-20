export type AgentEventType = "token" | "tool" | "status" | "result" | "error" | "done";

export interface AgentEvent {
  type: AgentEventType;
  data: unknown;
}

export type StatusPhase = "parse" | "route" | "execute" | "agent" | "interpret" | "tool";

export interface StatusEventData {
  message: string;
  phase?: StatusPhase;
}

export interface ToolEventData {
  tool: string;
  args?: unknown;
  input?: unknown;
  intent?: Record<string, unknown>;
  status?: "running" | "done" | "error";
  output?: unknown;
  latencyMs?: number;
}
