import type { Context, Next } from "hono";
import { isValidSessionId } from "@pokt-mcp/shared";

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  defaultLimit: number;
  chatLimit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

export function loadRateLimitConfig(): RateLimitConfig {
  return {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    defaultLimit: Number(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE ?? 60),
    chatLimit: Number(process.env.RATE_LIMIT_CHAT_PER_MINUTE ?? 15),
  };
}

export class RateLimiter {
  private buckets = new Map<string, WindowState>();

  constructor(private readonly config: RateLimitConfig) {}

  check(key: string, limit: number): RateLimitResult {
    const now = Date.now();
    if (!this.config.enabled) {
      return { allowed: true, limit, remaining: limit, resetAt: now + this.config.windowMs };
    }

    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.config.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}

export function resolveClientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function resolveClientKey(c: Context): string {
  const session = c.req.header("x-session-id")?.trim();
  if (session && isValidSessionId(session)) {
    return `session:${session}`;
  }
  return `ip:${resolveClientIp(c)}`;
}

function applyRateLimitHeaders(c: Context, result: RateLimitResult): void {
  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    c.header("Retry-After", String(retryAfter));
  }
}

export function createRateLimitMiddleware(limiter: RateLimiter, config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    if (c.req.path === "/health") {
      return next();
    }

    const limit = c.req.path === "/chat" ? config.chatLimit : config.defaultLimit;
    const result = limiter.check(resolveClientKey(c), limit);
    applyRateLimitHeaders(c, result);

    if (!result.allowed) {
      return c.json(
        {
          error: "RATE_LIMITED: too many requests for this client",
          code: "RATE_LIMITED",
          retryAfterSec: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
        },
        429,
      );
    }

    return next();
  };
}
