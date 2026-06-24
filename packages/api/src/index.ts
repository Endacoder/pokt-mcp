import {
  INTERNAL_API_KEY_HEADER,
  requireSessionId,
  SESSION_TOKEN_HEADER,
  logLlmConfigStatus,
  isWriteRpcMethod,
  applyGasSafetyBufferHex,
} from "@pokt-mcp/shared";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createAgentOrchestrator, prepareSwapForSigning, fetchQuoteConfirmation, submitSwapSignature, pollSwapIntentStatus, getSwapIntentStatus, getChatSession, setChatSession, syncPermitSignerForIntent } from "@pokt-mcp/agent-orchestrator";
import {
  isQuoteExpiredError,
  isConfirmationRequiredError,
  isRouteBuildError,
  isInsufficientAllowanceError,
  isInvalidSignatureSubmitError,
  isWalletAccountMismatchError,
  isSimulationTransferFailedError,
  isOneinchOrderBuildError,
  isUserPaidGasRequiredError,
  isInvalidExecutionModeError,
  PermitAmountMismatchError,
  OrderQuoteMismatchError,
  fetchSwapSigningInstructions,
} from "@pokt-mcp/agent-orchestrator";
import { createPocketClient, initRegistry, listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { pollTxLookup } from "@pokt-mcp/nl-rpc";
import { buildTransfer, buildTransactionFeesOnly, normalizeGasQuantity, checksumAddress, parseValueToHex } from "@pokt-mcp/tx-builder";
import { type ChatRequest, type RpcRequest, type WalletTxBroadcastRequest, type WalletTxPreviewRequest } from "@pokt-mcp/shared";
import { loadPolicyConfig, assertWritePolicy, assertMethodAllowed } from "./policy.js";
import { createRateLimitMiddleware, loadRateLimitConfig, RateLimiter } from "./rate-limit.js";
import { createInternalAuthMiddleware, loadInternalAuthConfig } from "./internal-auth.js";
import {
  createSessionTokenMiddleware,
  createSessionTokenRoute,
  loadSessionTokenConfig,
} from "./session-token.js";
import { parseWalletAddress, resolveSwapWalletAddress } from "./swap-wallet.js";

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
    history: body.history,
    chain: wallet?.chainSlug ?? body.chain,
    connectedAddress: body.connectedAddress ?? wallet?.address,
    swapExecutionMode: body.swapExecutionMode,
  };

  const KEEPALIVE_MS = 10_000;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "ping", data: "{}" });
    const keepalive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, KEEPALIVE_MS);
    try {
      for await (const event of agent.runChat(chatInput)) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
      }
    } finally {
      clearInterval(keepalive);
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
  const address = body.address?.trim() || undefined;
  walletSessions.set(sessionId, { address, chainSlug: body.chainSlug || undefined });
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
      gasLimit: body.gasLimit,
    });
    return c.json({
      summary: `Transfer to ${body.to} on ${info.slug}`,
      transaction: built,
      estimatedGas: built.gas,
      explorerUrl: info.blockExplorer,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const selector = body.data?.slice(0, 10) ?? "";
    const gasHex = normalizeGasQuantity(body.gasLimit);
    const estimateFailed =
      /estimate|execution reverted|revert/i.test(errMsg) && Boolean(body.data && body.data !== "0x");

    if (estimateFailed && gasHex) {
      try {
        const fees = await buildTransactionFeesOnly({ chain: info.slug, from: body.from });
        const value = parseValueToHex(body.value ?? "0");
        return c.json({
          summary: `Contract call to ${body.to} on ${info.slug} (gas estimate unavailable — using route gas limit)`,
          transaction: {
            ...fees,
            to: checksumAddress(body.to),
            value,
            data: body.data ?? "0x",
            gas: applyGasSafetyBufferHex(gasHex),
          },
          estimatedGas: applyGasSafetyBufferHex(gasHex),
          gasEstimateFallback: true,
          explorerUrl: info.blockExplorer,
        });
      } catch {
        /* fees-only fallback failed — return original estimate error */
      }
    }

    return c.json({ error: errMsg }, 400);
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

app.post("/wallet/tx/verify", async (c) => {
  const body = await c.req.json<{ chain?: string; txHash?: string; timeoutMs?: number }>();
  const chainSlug = body.chain?.trim();
  const txHash = body.txHash?.trim();
  if (!chainSlug || !txHash) {
    return c.json({ error: "chain and txHash are required" }, 400);
  }
  const info = resolveChain(chainSlug);
  if (!info) return c.json({ error: `CHAIN_NOT_FOUND: ${chainSlug}` }, 404);
  try {
    const polled = await pollTxLookup(pocket, info.slug, txHash, "eth_getTransactionByHash", {
      timeoutMs: body.timeoutMs ?? 20_000,
      pollIntervalMs: 2_000,
    });
    return c.json({
      found: polled.result != null,
      pending: polled.pending ?? false,
      waitedMs: polled.waitedMs,
      pollAttempts: polled.pollAttempts,
      chain: info.slug,
      chainName: info.name,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/swap/quote-confirmation", async (c) => {
  const body = await c.req.json<{ quoteId?: string; walletAddress?: string }>();
  if (!body.quoteId?.trim()) {
    return c.json({ error: "quoteId is required" }, 400);
  }
  const walletAddress = resolveSwapWalletAddress(
    c.req.header("x-session-id"),
    body.walletAddress,
    walletSessions,
  );
  if (!walletAddress) {
    return c.json({ error: "walletAddress is required — connect your wallet first" }, 400);
  }
  try {
    const confirmation = await fetchQuoteConfirmation(body.quoteId.trim(), walletAddress);
    return c.json(confirmation);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
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
    return c.json({ error: message }, 400);
  }
});

  app.post("/swap/prepare", async (c) => {
  const body = await c.req.json<{
    quoteId?: string;
    walletAddress?: string;
    confirmationSignature?: string;
    acknowledgeUserPaidGas?: boolean;
    quoteExecutionMode?: string;
    quoteRoute?: string;
    quoteRouteType?: string;
    quoteGasEstimateUsd?: number;
    quoteGasless?: boolean;
    expectedPermit?: { tokenAddress?: string; amountAtomic?: string };
    expectedQuote?: {
      tokenInAddress?: string;
      tokenOutAddress?: string;
      amountInAtomic?: string;
      chainId?: number;
    };
    requote?: {
      fromChain?: number;
      toChain?: number;
      tokenIn?: string;
      tokenOut?: string;
      amount?: string;
      slippageBps?: number;
      executionMode?: "any" | "gasless";
    };
  }>();
  if (!body.quoteId?.trim()) {
    return c.json({ error: "quoteId is required" }, 400);
  }
  const walletAddress = resolveSwapWalletAddress(
    c.req.header("x-session-id"),
    body.walletAddress,
    walletSessions,
  );
  if (!walletAddress) {
    return c.json({ error: "walletAddress is required — connect your wallet first" }, 400);
  }
  try {
    const expectedQuote =
      body.expectedQuote?.tokenInAddress?.trim() &&
      body.expectedQuote?.tokenOutAddress?.trim() &&
      body.expectedQuote?.amountInAtomic?.trim() &&
      body.expectedQuote.chainId != null
        ? {
            tokenInAddress: body.expectedQuote.tokenInAddress.trim(),
            tokenOutAddress: body.expectedQuote.tokenOutAddress.trim(),
            amountInAtomic: body.expectedQuote.amountInAtomic.trim(),
            chainId: body.expectedQuote.chainId,
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
            executionMode:
              body.requote.executionMode === "gasless"
                ? ("gasless" as const)
                : ("any" as const),
          }
        : undefined;
    const result = await prepareSwapForSigning(
      body.quoteId.trim(),
      walletAddress,
      expectedQuote?.tokenOutAddress ? expectedQuote : undefined,
      requote,
      body.confirmationSignature?.trim() || undefined,
      {
        acknowledgeUserPaidGas: body.acknowledgeUserPaidGas,
        quoteExecutionMode: body.quoteExecutionMode?.trim(),
        quoteRoute: body.quoteRoute?.trim(),
        quoteRouteType: body.quoteRouteType?.trim(),
        quoteGasEstimateUsd: body.quoteGasEstimateUsd,
        quoteGasless: body.quoteGasless,
      },
    );
    if (result.requoteApplied && !result.intentId) {
      return c.json({
        requoteApplied: true,
        requoteNote: result.requoteNote,
        freshQuoteId: result.freshQuoteId,
        freshQuoteExpiresAt: result.freshQuoteExpiresAt,
        freshExecutionMode: result.freshExecutionMode,
        confirmationRequired: true,
      });
    }
    return c.json({
      intentId: result.intentId,
      signingInstructions: result.signingInstructions,
      requoteApplied: result.requoteApplied ?? false,
      requoteNote: result.requoteNote,
      freshQuoteId: result.freshQuoteId,
      freshQuoteExpiresAt: result.freshQuoteExpiresAt,
      freshExecutionMode: result.freshExecutionMode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
    }
    if (err instanceof PermitAmountMismatchError) {
      return c.json({ error: message, code: "PERMIT_AMOUNT_MISMATCH" }, 400);
    }
    if (err instanceof OrderQuoteMismatchError) {
      return c.json({ error: message, code: "ORDER_QUOTE_MISMATCH" }, 400);
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
    if (isConfirmationRequiredError(message)) {
      return c.json(
        {
          error:
            "Wallet confirmation signature required — sign the quote authorization message in your wallet first.",
          code: "CONFIRMATION_REQUIRED",
        },
        400,
      );
    }
    if (isUserPaidGasRequiredError(message)) {
      return c.json(
        {
          error:
            "This quote uses a user-paid gas route (Uniswap CLASSIC / LI.FI). Confirm the swap again — you will pay network gas, or switch Swap execution to Gasless and request a new quote.",
          code: "USER_PAID_GAS_REQUIRED",
        },
        400,
      );
    }
    if (isInvalidExecutionModeError(message)) {
      return c.json(
        {
          error:
            "Deprecated gas execution mode was rejected. Request a new quote with Best price or Gasless.",
          code: "INVALID_EXECUTION_MODE",
        },
        400,
      );
    }
    if (/Simulation failed|SIMULATION_FAILED/i.test(message)) {
      const rpcHint = /your-key|your-alchemy-key|not a valid request object/i.test(message)
        ? " Intent MCP is using an invalid RPC URL — set RPC_ETHEREUM (and other chain RPCs) in the intent-api .env to a real endpoint (e.g. https://eth.api.pocket.network) and restart intent-api."
        : "";
      const transferHint = isSimulationTransferFailedError(message)
        ? " The router could not pull your input token — confirm your wallet holds enough of the token you're selling. Try Gasless or Best price in Settings → Swap execution, then request a fresh quote."
        : "";
      return c.json(
        {
          error: `Swap simulation failed before signing.${transferHint}${rpcHint} ${message.slice(0, 200)}`,
          code: "SIMULATION_FAILED",
        },
        400,
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
    if (/fresh re-quote was attempted but also failed/i.test(message)) {
      return c.json({ error: message, code: "ROUTE_BUILD_FAILED" }, 502);
    }
    if (isOneinchOrderBuildError(message)) {
      return c.json(
        {
          error:
            "1inch Fusion gasless on Ethereum Mainnet is unavailable (Intent MCP feeReceiver). Request a new quote with Swap execution set to Best price, or try the same swap on Base.",
          code: "ROUTE_BUILD_FAILED",
        },
        502,
      );
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/swap/sync-permit", async (c) => {
  const body = await c.req.json<{
    intentId?: string;
    signature?: string;
    walletAddress?: string;
  }>();
  if (!body.intentId?.trim() || !body.signature?.trim()) {
    return c.json({ error: "intentId and signature are required" }, 400);
  }
  const walletAddress = resolveSwapWalletAddress(
    c.req.header("x-session-id"),
    body.walletAddress,
    walletSessions,
  );
  try {
    const result = await syncPermitSignerForIntent(
      body.intentId.trim(),
      body.signature.trim(),
      walletAddress ?? undefined,
    );
    const raw = result.raw as Record<string, unknown>;
    const permitSigner =
      typeof raw.permitSigner === "string"
        ? raw.permitSigner
        : typeof raw.walletAddress === "string"
          ? raw.walletAddress
          : undefined;
    return c.json({
      intentId: result.intentId,
      status: result.status,
      txHash: result.txHash,
      permitSigner,
      walletAddressCorrected: raw.walletAddressCorrected === true,
      pendingMoreSignatures: result.pendingMoreSignatures ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/swap/instructions", async (c) => {
  const body = await c.req.json<{ intentId?: string }>();
  if (!body.intentId?.trim()) {
    return c.json({ error: "intentId is required" }, 400);
  }
  try {
    const signingInstructions = await fetchSwapSigningInstructions(body.intentId.trim());
    return c.json({ intentId: body.intentId.trim(), signingInstructions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/swap/submit", async (c) => {
  const body = await c.req.json<{
    intentId?: string;
    signature?: string;
    txHash?: string;
    walletAddress?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    chainName?: string;
  }>();
  if (!body.intentId?.trim() || !body.signature?.trim()) {
    return c.json({ error: "intentId and signature are required" }, 400);
  }
  const walletAddress = resolveSwapWalletAddress(
    c.req.header("x-session-id"),
    body.walletAddress,
    walletSessions,
  );
  if (!walletAddress) {
    return c.json({ error: "walletAddress is required — connect your wallet first" }, 400);
  }
  try {
    const txHash = body.txHash?.trim() || undefined;
    const signed = txHash && txHash === body.signature.trim() ? txHash : body.signature.trim();
    const result = await submitSwapSignature(
      body.intentId.trim(),
      signed,
      walletAddress,
      txHash,
    );
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
    return c.json({
      intentId: result.intentId,
      status: result.status,
      txHash: result.txHash,
      pendingMoreSignatures: result.pendingMoreSignatures ?? false,
      signingInstructions: result.signingInstructions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isInsufficientAllowanceError(message)) {
      return c.json(
        {
          error:
            "This swap needs a one-time token approval to Permit2 before the swap signature. Try again — your wallet should prompt for an approval transaction first.",
          code: "INSUFFICIENT_ALLOWANCE",
        },
        400,
      );
    }
    if (isWalletAccountMismatchError(message)) {
      return c.json({ error: message, code: "WALLET_ACCOUNT_MISMATCH" }, 400);
    }
    if (isInvalidSignatureSubmitError(message)) {
      const permitHint =
        "Sign the Permit2 EIP-712 prompt (not the ERC20 approval transaction or quote confirmation message), then try again.";
      const error =
        /Permit2|transaction hash instead of a Permit2 signature/i.test(message)
          ? /Sign the Permit2 EIP-712 prompt/i.test(message)
            ? message
            : `${message} ${permitHint}`
          : "1inch rejected the wallet signature for this gasless order. Switch MetaMask to the account shown in the order, request a fresh quote, sign the EIP-712 prompt (not a transaction), and confirm within 60 seconds.";
      return c.json({ error, code: "INVALID_SWAP_SIGNATURE" }, 400);
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/swap/status", async (c) => {
  const body = await c.req.json<{ intentId?: string; poll?: boolean }>();
  if (!body.intentId?.trim()) {
    return c.json({ error: "intentId is required" }, 400);
  }
  try {
    const intentId = body.intentId.trim();
    const result = body.poll ? await pollSwapIntentStatus(intentId) : await getSwapIntentStatus(intentId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("INTENT_MCP_NOT_CONFIGURED")) {
      return c.json({ error: message, code: "INTENT_MCP_NOT_CONFIGURED" }, 503);
    }
    return c.json({ error: message }, 400);
  }
});

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? "127.0.0.1";

await initRegistry();

serve({ fetch: app.fetch, port, hostname }, () => {
  logLlmConfigStatus("pokt-mcp-api");
  console.log(`pokt-mcp API listening on http://${hostname}:${port}`);
});
