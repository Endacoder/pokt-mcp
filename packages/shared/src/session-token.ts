import { isValidSessionId } from "./session.js";

export const SESSION_TOKEN_HEADER = "x-session-token";

export interface SessionTokenPayload {
  sessionId: string;
  exp: number;
}

export interface SessionTokenConfig {
  secret?: string;
  ttlMs: number;
}

export function loadSessionTokenConfig(): SessionTokenConfig {
  return {
    secret: process.env.SESSION_SIGNING_SECRET?.trim(),
    ttlMs: Number(process.env.SESSION_TOKEN_TTL_MS ?? 86_400_000),
  };
}

export function isSessionTokenRequired(config: SessionTokenConfig): boolean {
  return Boolean(config.secret);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signSessionToken(
  sessionId: string,
  secret: string,
  ttlMs: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${sessionId}.${expiresAt}`;
  const signature = await hmacSha256Hex(secret, payload);
  return { token: `${payload}.${signature}`, expiresAt };
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [sessionId, expRaw, signature] = parts;
  const exp = Number(expRaw);
  if (!isValidSessionId(sessionId) || !Number.isFinite(exp)) return null;
  if (Date.now() > exp) return null;

  const expected = await hmacSha256Hex(secret, `${sessionId}.${exp}`);
  if (!timingSafeEqual(signature, expected)) return null;

  return { sessionId, exp };
}

export function sessionTokenMatchesSession(
  payload: SessionTokenPayload,
  sessionId: string | undefined | null,
): boolean {
  const id = sessionId?.trim();
  return Boolean(id) && payload.sessionId === id;
}
