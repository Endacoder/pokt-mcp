import type { Context, Next } from "hono";
import {
  SESSION_TOKEN_HEADER,
  isSessionTokenRequired,
  loadSessionTokenConfig,
  sessionTokenMatchesSession,
  signSessionToken,
  verifySessionToken,
} from "@pokt-mcp/shared";
import { requireSessionId } from "@pokt-mcp/shared";

export { loadSessionTokenConfig };

function isExemptPath(method: string, path: string): boolean {
  if (path === "/health") return true;
  return method === "POST" && path === "/session/token";
}

export function createSessionTokenMiddleware(config: ReturnType<typeof loadSessionTokenConfig>) {
  return async (c: Context, next: Next) => {
    if (!isSessionTokenRequired(config) || !config.secret) {
      return next();
    }

    if (isExemptPath(c.req.method, c.req.path)) {
      return next();
    }

    const sessionId = c.req.header("x-session-id");
    const token = c.req.header(SESSION_TOKEN_HEADER);
    if (!token) {
      return c.json({ error: "SESSION_TOKEN_REQUIRED", code: "UNAUTHORIZED" }, 401);
    }

    const payload = await verifySessionToken(token, config.secret);
    if (!payload || !sessionTokenMatchesSession(payload, sessionId)) {
      return c.json({ error: "SESSION_TOKEN_INVALID", code: "UNAUTHORIZED" }, 401);
    }

    return next();
  };
}

export function createSessionTokenRoute(config: ReturnType<typeof loadSessionTokenConfig>) {
  return async (c: Context) => {
    if (!config.secret) {
      return c.json({ error: "SESSION_TOKEN_DISABLED" }, 503);
    }

    const body = (await c.req.json<{ sessionId?: string }>().catch(() => ({ sessionId: undefined }))) as {
      sessionId?: string;
    };
    let sessionId: string;
    try {
      sessionId = requireSessionId(body.sessionId ?? c.req.header("x-session-id"));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }

    const signed = await signSessionToken(sessionId, config.secret, config.ttlMs);
    return c.json({ ...signed, sessionId });
  };
}
