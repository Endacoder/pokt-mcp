import {
  isSessionTokenRequired,
  loadSessionTokenConfig,
  SESSION_TOKEN_HEADER,
  sessionTokenMatchesSession,
  verifySessionToken,
} from "@pokt-mcp/shared/session-token";
import type { NextRequest } from "next/server";

export { loadSessionTokenConfig, isSessionTokenRequired };

export function isTokenExemptPath(pathname: string, method: string): boolean {
  if (pathname === "/api/health") return true;
  if (method === "GET" && pathname === "/api/wallet/config") return true;
  return method === "POST" && pathname === "/api/session/token";
}

export async function validateBrowserSessionToken(request: NextRequest): Promise<boolean> {
  const config = loadSessionTokenConfig();
  if (!isSessionTokenRequired(config) || !config.secret) return true;
  if (isTokenExemptPath(request.nextUrl.pathname, request.method)) return true;

  const sessionId = request.headers.get("x-session-id");
  const token = request.headers.get(SESSION_TOKEN_HEADER);
  if (!token) return false;

  const payload = await verifySessionToken(token, config.secret);
  return Boolean(payload && sessionTokenMatchesSession(payload, sessionId));
}
