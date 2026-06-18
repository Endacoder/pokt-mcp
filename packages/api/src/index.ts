import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createAgentOrchestrator } from "@pokt-mcp/agent-orchestrator";
import { createPocketClient, listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { buildTransfer } from "@pokt-mcp/tx-builder";
import type { ChatRequest, RpcRequest, WalletTxBroadcastRequest, WalletTxPreviewRequest } from "@pokt-mcp/shared";

const app = new Hono();
const pocket = createPocketClient();
const agent = createAgentOrchestrator();
const walletSessions = new Map<string, { address?: string; chainSlug?: string }>();

app.use("*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/chains", (c) => c.json({ chains: listChains() }));

app.post("/rpc", async (c) => {
  const body = await c.req.json<RpcRequest>();
  const info = resolveChain(body.chain);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    const resp = await pocket.rpc(info.slug, body.method, body.params ?? []);
    return c.json({ result: resp.result, meta: resp.meta });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();
  return streamSSE(c, async (stream) => {
    for await (const event of agent.runChat(body)) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
    }
  });
});

app.get("/wallet/status", (c) => {
  const sessionId = c.req.header("x-session-id") ?? "default";
  const session = walletSessions.get(sessionId) ?? {};
  return c.json({
    connected: Boolean(session.address),
    address: session.address,
    chainSlug: session.chainSlug,
    connectionType: session.address ? "injected" : "none",
  });
});

app.post("/wallet/session", async (c) => {
  const body = await c.req.json<{ sessionId?: string; address: string; chainSlug?: string }>();
  const sessionId = body.sessionId ?? "default";
  walletSessions.set(sessionId, { address: body.address, chainSlug: body.chainSlug });
  return c.json({ ok: true, sessionId });
});

app.post("/wallet/tx/preview", async (c) => {
  const body = await c.req.json<WalletTxPreviewRequest>();
  const info = resolveChain(body.chain);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    const built = await buildTransfer({
      chain: info.slug,
      from: body.from,
      to: body.to,
      value: body.value ?? "0",
      data: body.data,
    });
    return c.json({
      summary: `Transfer to ${body.to} on ${info.slug}`,
      transaction: built,
      estimatedGas: built.gas,
      explorerUrl: info.blockExplorer,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/wallet/tx/broadcast", async (c) => {
  const body = await c.req.json<WalletTxBroadcastRequest>();
  const info = resolveChain(body.chain);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    const resp = await pocket.broadcast<string>(info.slug, body.rawTransaction);
    return c.json({
      txHash: resp.result,
      status: "submitted",
      explorerUrl: info.blockExplorer ? `${info.blockExplorer}/tx/${resp.result}` : undefined,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  console.log(`pokt-mcp API listening on http://localhost:${port}`);
});
