import type { SessionContext } from "@pokt-mcp/shared";

const mcpSessions = new Map<string, SessionContext>();

export function getMcpSession(sessionId: string): SessionContext | undefined {
  return mcpSessions.get(sessionId);
}

export function mergeMcpSession(sessionId: string | undefined, patch: SessionContext): SessionContext {
  if (!sessionId) return patch;
  const prev = mcpSessions.get(sessionId) ?? {};
  const merged = { ...prev, ...patch };
  mcpSessions.set(sessionId, merged);
  return merged;
}

export function updateMcpSession(sessionId: string, patch: Partial<SessionContext>): void {
  const prev = mcpSessions.get(sessionId) ?? {};
  mcpSessions.set(sessionId, { ...prev, ...patch });
}

export function getAllMcpSessions(): Record<string, SessionContext> {
  return Object.fromEntries(mcpSessions);
}
