import {
  INTERNAL_API_KEY_HEADER,
  requireSessionId,
  SESSION_TOKEN_HEADER,
  logLlmConfigStatus,
  isWriteRpcMethod,
} from "@pokt-mcp/shared";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createAgentOrchestrator, prepareSwapForSigning, submitSwapSignature, getChatSession, setChatSession } from "@pokt-mcp/agent-orchestrator";
import { isQuoteExpiredError, isRouteBuildError, PermitAmountMismatchError } from "@pokt-mcp/agent-orchestrator";
import { createPocketClient, listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { buildTransfer } from "@pokt-mcp/tx-builder";
import type { ChatRequest, RpcRequest, WalletTxBroadcastRequest, WalletTxPreviewRequest } from "@pokt-mcp/shared";
import { loadPolicyConfig, assertWritePolicy, assertMethodAllowed } from "./policy.js";
import { createRateLimitMiddleware, loadRateLimitConfig, RateLimiter } from "./rate-limit.js";
import { createInternalAuthMiddleware, loadInternalAuthConfig } from "./internal-auth.js";
import {
  createSessionTokenMiddleware,
  createSessionTokenRoute,
  loadSessionTokenConfig,
} from "./session-token.js";

const app = new Hono();
const pocket = createPocketClient();
const agent = createAgentOrchestrator();
const policy = loadPolicyConfig();
const rateLimitConfig = loadRateLimitConfig();
const rateLimiter = new RateLimiter(rateLimitConfig);
const internalAuthConfig = loadInternalAuthConfig();
const sessionTokenConfig = loadSessionTokenConfig();
const walletSessions = new Map<string, { address?: string; chainSlug?: string }>();

const corsOrigin = internalAuthConfig.publicAppUrl ?? "*";
app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowHeaders: ["Content-Type", "x-session-id", INTERNAL_API_KEY_HEADER, SESSION_TOKEN_HEADER],
  }),
);
app.use("*", createInternalAuthMiddleware(internalAuthConfig));
app.use("*", createSessionTokenMiddleware(sessionTokenConfig));
app.use("*", createRateLimitMiddleware(rateLimiter, rateLimitConfig));

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/session/token", createSessionTokenRoute(sessionTokenConfig));

app.get("/chains", (c) => c.json({ chains: listChains() }));

app.post("/rpc", async (c) => {
  const body = await c.req.json<RpcRequest>();
  const info = resolveChain(body.chain);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    assertMethodAllowed(policy, body.method);
    if (isWriteRpcMethod(body.method)) {
      return c.json({ error: `POLICY_DENIED: write method "${body.method}" — use wallet routes` }, 403);
    }
    const resp = await pocket.rpc(info.slug, body.method, body.params ?? []);
    return c.json({ result: resp.result, meta: resp.meta });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/chat", async (c) => {
  const body = await c.req.json<ChatRequest>();
  let sessionId: string;
  try {
    sessionId = requireSessionId(body.sessionId);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const wallet = walletSessions.get(sessionId);
  const chatInput: ChatRequest = {
    ...body,
    sessionId,
    chain: wallet?.chainSlug ?? body.chain,
    connectedAddress: wallet?.address ?? body.connectedAddress,
    swapExecutionMode: body.swapExecutionMode,
  };

  return streamSSE(c, async (stream) => {
    for await (const event of agent.runChat(chatInput)) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
    }
  });
});

app.get("/wallet/status", (c) => {
  let sessionId: string;
  try {
    sessionId = requireSessionId(c.req.header("x-session-id"));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  const session = walletSessions.get(sessionId) ?? {};
  return c.json({
    connected: Boolean(session.address),
    address: session.address,
    chainSlug: session.chainSlug,
    connectionType: session.address ? "injected" : "none",
  });
});

app.post("/wallet/session", async (c) => {
  const body = await c.req.json<{ sessionId: string; address: string; chainSlug?: string }>();
  let sessionId: string;
  try {
    sessionId = requireSessionId(body.sessionId);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  walletSessions.set(sessionId, { address: body.address, chainSlug: body.chainSlug });
  return c.json({ ok: true, sessionId });
});

app.post("/wallet/tx/preview", async (c) => {
  const body = await c.req.json<WalletTxPreviewRequest>();
  const info = resolveChain(body.chain);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    if (!policy.allowedChains.has(info.slug)) {
      return c.json({ error: `POLICY_DENIED: chain "${info.slug}" not allowed` }, 403);
    }
    const valueHex = body.value?.startsWith("0x")
      ? body.value
      : body.value
        ? `0x${BigInt(Math.floor(parseFloat(body.value) * 1e18)).toString(16)}`
        : undefined;
    assertWritePolicy(policy, { chain: info.slug, value: valueHex });
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
    if (!policy.allowedChains.has(info.slug)) {
      return c.json({ error: `POLICY_DENIED: chain "${info.slug}" not allowed` }, 403);
    }
    const resp = await pocket.broadcast<string>(info.slug, body.rawTransaction);
    const txHash = resp.result;
    const result = {
      txHash,
      status: "submitted" as const,
      explorerUrl: info.blockExplorer ? `${info.blockExplorer}/tx/${txHash}` : undefined,
    };
    try {
      const sessionId = requireSessionId(c.req.header("x-session-id"));
      const prev = getChatSession(sessionId) ?? {};
      setChatSession(sessionId, {
        ...prev,
        lastSendTx: {
          txHash,
          chain: info.slug,
          chainName: info.name,
          submittedAt: new Date().toISOString(),
          status: "submitted",
          explorerUrl: result.explorerUrl,
        },
      });
    } catch {
      /* optional session tracking */
    }
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/wallet/tx/record", async (c) => {
  const body = await c.req.json<{
    txHash?: string;
    chain?: string;
    to?: string;
    valueNative?: string;
    nativeSymbol?: string;
    explorerUrl?: string;
  }>();
  if (!body.txHash?.trim() || !body.chain?.trim()) {
    return c.json({ error: "txHash and chain are required" }, 400);
  }
  const info = resolveChain(body.chain.trim());
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${body.chain}` }, 404);
  try {
    const sessionId = requireSessionId(c.req.header("x-session-id"));
    const prev = getChatSession(sessionId) ?? {};
    const explorerUrl =
      body.explorerUrl?.trim() ||
      (info.blockExplorer ? `${info.blockExplorer.replace(/\/$/, "")}/tx/${body.txHash.trim()}` : undefined);
    setChatSession(sessionId, {
      ...prev,
      lastSendTx: {
        txHash: body.txHash.trim(),
        chain: info.slug,
        chainName: info.name,
        to: body.to?.trim() || undefined,
        valueNative: body.valueNative?.trim() || undefined,
        nativeSymbol: body.nativeSymbol?.trim() || info.nativeSymbol,
        submittedAt: new Date().toISOString(),
        status: "submitted",
        explorerUrl,
      },
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/swap/prepare", async (c) => {
  const body = await c.req.json<{
    quoteId?: string;
    walletAddress?: string;
    expectedPermit?: { tokenAddress?: string; amountAtomic?: string };
    requote?: {
      fromChain?: number;
      toChain?: number;
      tokenIn?: string;
      tokenOut?: string;
      amount?: string;
      slippageBps?: number;
      executionMode?: "any" | "gasless" | "gas";
    };
  }>();
  if (!body.quoteId?.trim()) {
    return c.json({ error: "quoteId is required" }, 400);
  }
  if (!body.walletAddress?.trim()) {
    return c.json({ error: "walletAddress is required — connect your wallet first" }, 400);
  }
  try {
    const expectedPermit =
      body.expectedPermit?.tokenAddress?.trim() && body.expectedPermit?.amountAtomic?.trim()
        ? {
            tokenAddress: body.expectedPermit.tokenAddress.trim(),
            amountAtomic: body.expectedPermit.amountAtomic.trim(),
          }
        : undefined;
    const requote =
      body.requote?.fromChain != null &&
      body.requote.tokenIn?.trim() &&
      body.requote.tokenOut?.trim() &&
      body.requote.amount?.trim()
        ? {
            fromChain: body.requote.fromChain,
            toChain: body.requote.toChain ?? body.requote.fromChain,
            tokenIn: body.requote.tokenIn.trim(),
            tokenOut: body.requote.tokenOut.trim(),
            amount: body.requote.amount.trim(),
            slippageBps: body.requote.slippageBps,
            executionMode: body.requote.executionMode,
          }
        : undefined;
    const result = await prepareSwapForSigning(
      body.quoteId.trim(),
      body.walletAddress.trim(),
      expectedPermit,
      requote,
    );
    return c.json({
      intentId: result.intentId,
      signingInstructions: result.signingInstructions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
    }
    if (err instanceof PermitAmountMismatchError) {
      return c.json({ error: message, code: "PERMIT_AMOUNT_MISMATCH" }, 400);
    }
    if (isQuoteExpiredError(message)) {
      return c.json(
        {
          error: "This swap quote has expired. Ask for a new quote and confirm within 60 seconds.",
          code: "QUOTE_EXPIRED",
        },
        410,
      );
    }
    if (message.includes("SIGNING_PAYLOAD_UNAVAILABLE")) {
      return c.json({ error: message, code: "SIGNING_PAYLOAD_UNAVAILABLE" }, 422);
    }
    if (isRouteBuildError(message)) {
      return c.json(
        {
          error:
            "This swap route failed to build (Intent MCP Uniswap backend). Connect your wallet before requesting a quote, then confirm within 60 seconds. If it persists, try ETH↔USDT or USDC↔ETH on Base.",
          code: "ROUTE_BUILD_FAILED",
        },
        502,
      );
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/swap/submit", async (c) => {
  const body = await c.req.json<{
    intentId?: string;
    signature?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    chainName?: string;
  }>();
  if (!body.intentId?.trim() || !body.signature?.trim()) {
    return c.json({ error: "intentId and signature are required" }, 400);
  }
  try {
    const result = await submitSwapSignature(body.intentId.trim(), body.signature.trim());
    try {
      const sessionId = requireSessionId(c.req.header("x-session-id"));
      const prev = getChatSession(sessionId) ?? {};
      setChatSession(sessionId, {
        ...prev,
        lastSwapIntent: {
          intentId: result.intentId,
          txHash: result.txHash,
          status: result.status,
          submittedAt: new Date().toISOString(),
          tokenIn: body.tokenIn?.trim() || undefined,
          tokenOut: body.tokenOut?.trim() || undefined,
          amountIn: body.amountIn?.trim() || undefined,
          chainName: body.chainName?.trim() || undefined,
        },
      });
    } catch {
      /* session tracking optional when x-session-id missing/invalid */
    }
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, () => {
  logLlmConfigStatus("pokt-mcp-api");
  console.log(`pokt-mcp API listening on http://${hostname}:${port}`);
});
