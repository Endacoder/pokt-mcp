import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { INTERNAL_API_KEY_HEADER } from "@pokt-mcp/shared";
import { createInternalAuthMiddleware, loadInternalAuthConfig } from "./internal-auth.js";

describe("createInternalAuthMiddleware", () => {
  it("blocks requests without the internal key when configured", async () => {
    const config = { internalApiKey: "secret", publicAppUrl: "https://pokt.metalift.ai" };
    const app = new Hono();
    app.use("*", createInternalAuthMiddleware(config));
    app.get("/chains", (c) => c.json({ ok: true }));

    const denied = await app.request("http://localhost/chains");
    const allowed = await app.request("http://localhost/chains", {
      headers: { [INTERNAL_API_KEY_HEADER]: "secret" },
    });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it("allows all requests when no key is configured", async () => {
    const config = loadInternalAuthConfig();
    const app = new Hono();
    app.use("*", createInternalAuthMiddleware({ ...config, internalApiKey: undefined }));
    app.get("/chains", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/chains");
    expect(res.status).toBe(200);
  });

  it("allows unauthenticated health checks when key is configured", async () => {
    const config = { internalApiKey: "secret", publicAppUrl: "https://pokt.metalift.ai" };
    const app = new Hono();
    app.use("*", createInternalAuthMiddleware(config));
    app.get("/health", (c) => c.json({ status: "ok" }));

    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
  });
});
