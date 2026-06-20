import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { INTERNAL_API_KEY_HEADER, SESSION_TOKEN_HEADER } from "@pokt-mcp/shared";
import { createInternalAuthMiddleware } from "./internal-auth.js";
import { createSessionTokenMiddleware, createSessionTokenRoute } from "./session-token.js";

const SESSION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

describe("session token middleware", () => {
  it("blocks protected routes without a token", async () => {
    const config = { secret: "secret", ttlMs: 60_000 };
    const app = new Hono();
    app.use("*", createSessionTokenMiddleware(config));
    app.post("/session/token", createSessionTokenRoute(config));
    app.get("/chains", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/chains", {
      headers: { "x-session-id": SESSION_ID },
    });
    expect(res.status).toBe(401);
  });

  it("allows requests with a valid token", async () => {
    const config = { secret: "secret", ttlMs: 60_000 };
    const app = new Hono();
    app.post("/session/token", createSessionTokenRoute(config));
    app.use("*", createSessionTokenMiddleware(config));
    app.get("/chains", (c) => c.json({ ok: true }));

    const mint = await app.request("http://localhost/session/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    });
    const { token } = (await mint.json()) as { token: string };

    const res = await app.request("http://localhost/chains", {
      headers: {
        "x-session-id": SESSION_ID,
        [SESSION_TOKEN_HEADER]: token,
      },
    });
    expect(res.status).toBe(200);
  });

  it("mints tokens on /session/token when internal auth passes", async () => {
    const config = { secret: "secret", ttlMs: 60_000 };
    const internal = { internalApiKey: "internal", publicAppUrl: undefined };
    const app = new Hono();
    app.use("*", createInternalAuthMiddleware(internal));
    app.post("/session/token", createSessionTokenRoute(config));

    const denied = await app.request("http://localhost/session/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    });
    const allowed = await app.request("http://localhost/session/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_API_KEY_HEADER]: "internal",
      },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
  });
});
