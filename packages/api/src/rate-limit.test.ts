import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRateLimitMiddleware, loadRateLimitConfig, RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = new RateLimiter({
      enabled: true,
      windowMs: 60_000,
      defaultLimit: 3,
      chatLimit: 1,
    });

    expect(limiter.check("session:test", 3).allowed).toBe(true);
    expect(limiter.check("session:test", 3).allowed).toBe(true);
    expect(limiter.check("session:test", 3).allowed).toBe(true);
    expect(limiter.check("session:test", 3).allowed).toBe(false);
  });

  it("tracks clients independently", () => {
    const limiter = new RateLimiter({
      enabled: true,
      windowMs: 60_000,
      defaultLimit: 1,
      chatLimit: 1,
    });

    expect(limiter.check("session:a", 1).allowed).toBe(true);
    expect(limiter.check("session:b", 1).allowed).toBe(true);
    expect(limiter.check("session:a", 1).allowed).toBe(false);
  });
});

describe("createRateLimitMiddleware", () => {
  it("returns 429 when a client exceeds the limit", async () => {
    const config = { enabled: true, windowMs: 60_000, defaultLimit: 1, chatLimit: 1 };
    const app = new Hono();
    app.use("*", createRateLimitMiddleware(new RateLimiter(config), config));
    app.get("/chains", (c) => c.json({ ok: true }));

    const headers = { "x-session-id": "a1b2c3d4-e5f6-4789-a012-3456789abcde" };
    const first = await app.request("http://localhost/chains", { headers });
    const second = await app.request("http://localhost/chains", { headers });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("skips health checks", async () => {
    const config = loadRateLimitConfig();
    config.enabled = true;
    config.defaultLimit = 0;
    const app = new Hono();
    app.use("*", createRateLimitMiddleware(new RateLimiter(config), config));
    app.get("/health", (c) => c.json({ status: "ok" }));

    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
  });
});
