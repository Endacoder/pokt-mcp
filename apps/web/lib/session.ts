const SESSION_STORAGE_KEY = "pokt-mcp-session-id";
const TOKEN_STORAGE_KEY = "pokt-mcp-session-token";
const TOKEN_EXP_STORAGE_KEY = "pokt-mcp-session-token-exp";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function getSessionId(): string {
  if (typeof window === "undefined") {
    throw new Error("getSessionId() requires a browser environment");
  }

  let id = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  }
  return id;
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_EXP_STORAGE_KEY);
}

function getStoredToken(): { token: string; expiresAt: number } | null {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const expiresAt = Number(sessionStorage.getItem(TOKEN_EXP_STORAGE_KEY) ?? 0);
  if (!token || !expiresAt) return null;
  return { token, expiresAt };
}

export async function ensureSessionToken(apiUrl: string, force = false): Promise<void> {
  if (typeof window === "undefined") return;

  const sessionId = getSessionId();
  const stored = getStoredToken();
  if (!force && stored && stored.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return;
  }

  const res = await fetch(`${apiUrl}/session/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
    body: JSON.stringify({ sessionId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to obtain session token (${res.status})`);
  }

  const data = (await res.json()) as { token: string; expiresAt: number };
  sessionStorage.setItem(TOKEN_STORAGE_KEY, data.token);
  sessionStorage.setItem(TOKEN_EXP_STORAGE_KEY, String(data.expiresAt));
}

export function sessionHeaders(extra?: Record<string, string>, sessionId?: string): Record<string, string> {
  const sid = sessionId ?? getSessionId();
  const headers: Record<string, string> = {
    "x-session-id": sid,
    ...extra,
  };
  const token = getStoredToken()?.token;
  if (token) {
    headers["x-session-token"] = token;
  }
  return headers;
}
