import { loadIntentMcpConfig, verifyTxOnChain } from "@pokt-mcp/shared";
import { createIntentMcpSwapClient } from "./intent-mcp-client.js";
import {
  applyMainnetSmallSwapGasMode,
  extractIntentId,
  extractSigningPayloads,
  isOneinchOrderBuildError,
  isConfirmationRequiredError,
  isInvalidExecutionModeError,
  isRouteBuildError,
  isSimulationTransferFailedError,
  isSigningPayloadUnavailableError,
  isUserPaidGasRequiredError,
  normalizeSigningInstructions,
  quoteRequiresGasAck,
  validateSwapQuoteAgainstInstructions,
  type ExpectedSwapQuote,
  type PrepareIntentResponse,
  type SigningInstructions,
  type SubmitIntentResponse,
  type SwapRequoteParams,
} from "./intent-swap-types.js";
import type { SwapExecutionMode } from "@pokt-mcp/shared";
import { fetchQuoteForExecutionMode } from "./intent-swap.js";

export type SwapPrepareResult = {
  intentId: string;
  signingInstructions: SigningInstructions;
  prepare: PrepareIntentResponse;
  /** Server re-quoted after prepare failure — client should re-confirm before signing. */
  requoteApplied?: boolean;
  requoteNote?: string;
  freshQuoteId?: string;
  freshQuoteExpiresAt?: string;
  freshExecutionMode?: string;
};

export type QuoteConfirmationResult = {
  quoteId: string;
  walletAddress: string;
  quoteCommitment: string;
  message: string;
  expiresAt: string;
};

export type SwapSubmitResult = {
  intentId: string;
  status?: string;
  txHash?: string;
  /** User must sign again (0x approval→trade, Permit2→swap tx, etc.). */
  pendingMoreSignatures?: boolean;
  signingInstructions?: SigningInstructions;
  raw: SubmitIntentResponse;
};

export type SwapStatusResult = {
  intentId: string;
  status?: string;
  txHash?: string;
  orderHash?: string;
  error?: string;
  raw: Record<string, unknown>;
};

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ECDSA_SIG_RE = /^0x[a-fA-F0-9]{130}$/;

/** Normalize MetaMask ECDSA v byte (0/1 → 27/28) for 1inch / CoW relayers. */
export function normalizeSwapSignature(signature: string): string {
  const trimmed = signature.trim();
  if (!ECDSA_SIG_RE.test(trimmed)) return trimmed;
  const body = trimmed.slice(2);
  const r = body.slice(0, 64);
  const s = body.slice(64, 128);
  let v = parseInt(body.slice(128, 130), 16);
  if (v < 27) v += 27;
  return `0x${r}${s}${v.toString(16).padStart(2, "0")}`.toLowerCase();
}

export function isWalletAccountMismatchError(message: string): boolean {
  return /Permit2 signature is from .* but submit used/i.test(message);
}

export function isInvalidSignatureSubmitError(message: string): boolean {
  return (
    isWalletAccountMismatchError(message) ||
    /invalid signature|ORDER_SAVER_ERROR|Permit2 signature does not match|transaction hash instead of a Permit2 signature|Invalid Permit2 signature format/i.test(
      message,
    )
  );
}

/** On-chain tx hash only — never treat order UID / submission id as Etherscan tx. */
export function extractTxHash(raw: SubmitIntentResponse | Record<string, unknown>): string | undefined {
  const txHash = raw.txHash ?? raw.transactionHash;
  return typeof txHash === "string" && TX_HASH_RE.test(txHash) ? txHash : undefined;
}

export function extractOrderHash(raw: Record<string, unknown>): string | undefined {
  const orderHash = raw.orderHash;
  return typeof orderHash === "string" && orderHash.length > 0 ? orderHash : undefined;
}

function extractStatus(raw: Record<string, unknown>): string | undefined {
  const status = raw.status ?? raw.state;
  return typeof status === "string" && status.trim() ? status.trim() : undefined;
}

function needsMoreSignatures(raw: SubmitIntentResponse): boolean {
  if (raw.nextUnsignedIntent) return true;
  const status = extractStatus(raw)?.toLowerCase();
  return status === "pending_signature" || status === "pending_tx_signature";
}

function splitWalletResult(signed: string): { signature: string; txHash?: string } {
  const normalized = normalizeSwapSignature(signed);
  if (TX_HASH_RE.test(normalized)) {
    return { signature: normalized, txHash: normalized };
  }
  if (!ECDSA_SIG_RE.test(normalized)) {
    throw new Error(
      "Wallet returned an unexpected signing result. For gasless swaps, approve the EIP-712 signature prompt — not a transaction.",
    );
  }
  return { signature: normalized };
}

function logIntentRaw(
  _location: string,
  _hypothesisId: string,
  _intentId: string,
  raw: Record<string, unknown>,
): void {
  const chainId = typeof raw.fromChain === "number" ? raw.fromChain : undefined;
  const resolved = extractTxHash(raw);
  if (resolved && chainId != null) {
    void verifyTxOnChain(resolved, chainId);
  }
}

async function withIntentClient<T>(
  fn: (client: ReturnType<typeof createIntentMcpSwapClient>) => Promise<T>,
): Promise<T> {
  const config = loadIntentMcpConfig();
  if (!config) {
    throw new Error("INTENT_MCP_NOT_CONFIGURED: set INTENT_MCP_API_KEY on the API server");
  }
  const client = createIntentMcpSwapClient(config);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signingPayloadReady(instructions?: SigningInstructions): boolean {
  if (!instructions) return false;
  if (instructions.transaction || instructions.tx || instructions.method) return true;
  return extractSigningPayloads(instructions).length > 0;
}

async function fetchSigningInstructionsWithRetry(
  client: ReturnType<typeof createIntentMcpSwapClient>,
  intentId: string,
  attempts = 4,
): Promise<SigningInstructions | undefined> {
  let last: SigningInstructions | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = await client.getSigningInstructions(intentId);
      if (signingPayloadReady(last)) return last;
    } catch {
      /* Intent MCP may populate signing data shortly after prepare */
    }
    if (attempt < attempts - 1) {
      await sleep(350);
    }
  }
  return last;
}

async function requoteAndPrepare(
  client: ReturnType<typeof createIntentMcpSwapClient>,
  walletAddress: string,
  expectedQuote: ExpectedSwapQuote | undefined,
  requote: SwapRequoteParams,
  failureLabel: string,
  executionModeOverride?: SwapExecutionMode,
): Promise<SwapPrepareResult> {
  const executionMode: SwapExecutionMode =
    executionModeOverride ?? (requote.executionMode === "gasless" ? "gasless" : "any");
  const freshQuote = await fetchQuoteForExecutionMode(
    client,
    {
      fromChain: requote.fromChain,
      toChain: requote.toChain,
      tokenIn: requote.tokenIn,
      tokenOut: requote.tokenOut,
      amount: requote.amount,
      slippageBps: requote.slippageBps ?? 300,
      swapType: "EXACT_INPUT",
      walletAddress,
    },
    executionMode,
  );

  // Never prepare the fresh quote here — the wallet must personal_sign a new quote
  // authorization first, or Permit2 verification fails on submit.
  return {
    intentId: "",
    signingInstructions: {},
    prepare: {},
    requoteApplied: true,
    freshQuoteId: freshQuote.quoteId,
    freshQuoteExpiresAt: freshQuote.expiresAt,
    freshExecutionMode: freshQuote.executionMode,
    requoteNote:
      executionModeOverride === "gasless"
        ? "The on-chain route could not be simulated — likely missing token approval or balance. A fresh gasless quote was fetched. Click Authorize new quote, then sign the quote message and Permit2 prompt in your wallet."
        : executionModeOverride === "any" && requote.executionMode === "gasless"
          ? "Gasless routing was unavailable on this network. A fresh Best price quote was fetched — click Authorize new quote, then sign in your wallet."
          : `${failureLabel} Click Authorize new quote, then sign the quote authorization and Permit2 prompt in your wallet.`,
  };
}

export async function fetchQuoteConfirmation(
  quoteId: string,
  walletAddress: string,
): Promise<QuoteConfirmationResult> {
  return withIntentClient((client) => client.getQuoteConfirmation(quoteId, walletAddress));
}

export async function prepareSwapForSigning(
  quoteId: string,
  walletAddress: string,
  expectedQuote?: ExpectedSwapQuote,
  requote?: SwapRequoteParams,
  confirmationSignature?: string,
  options?: {
    acknowledgeUserPaidGas?: boolean;
    quoteExecutionMode?: string;
    quoteRoute?: string;
    quoteRouteType?: string;
    quoteGasEstimateUsd?: number;
    quoteGasless?: boolean;
  },
): Promise<SwapPrepareResult> {
  const adjustedRequote = applyMainnetSmallSwapGasMode(requote);
  const forceBestPriceRequote =
    adjustedRequote &&
    requote &&
    adjustedRequote.executionMode === "any" &&
    requote.executionMode === "gasless" &&
    requote.fromChain === 1;

  return withIntentClient(async (client) => {
    if (forceBestPriceRequote && adjustedRequote) {
      const prepared = await requoteAndPrepare(
        client,
        walletAddress,
        expectedQuote,
        adjustedRequote,
        "Ethereum Mainnet swaps under ~$20 use Best price routing — gasless orders often fail to fill.",
      );
      return {
        ...prepared,
        requoteApplied: true,
        requoteNote:
          "Swaps under ~$20 on Ethereum Mainnet were switched to Best price mode for reliable execution.",
      };
    }
    try {
      return await prepareSwapOnce(
        client,
        quoteId,
        walletAddress,
        expectedQuote,
        confirmationSignature,
        options,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isUserPaidGasRequiredError(message) && !options?.acknowledgeUserPaidGas) {
        return prepareSwapOnce(
          client,
          quoteId,
          walletAddress,
          expectedQuote,
          confirmationSignature,
          { ...options, acknowledgeUserPaidGas: true },
        );
      }
      if (isUserPaidGasRequiredError(message)) {
        throw new Error(
          "USER_PAID_GAS_REQUIRED: This quote requires you to pay network gas. Confirm you accept gas fees, or request a gasless quote.",
        );
      }
      if (isInvalidExecutionModeError(message) && adjustedRequote) {
        return requoteAndPrepare(
          client,
          walletAddress,
          expectedQuote,
          adjustedRequote,
          "Quote used a deprecated execution mode — fetched a fresh Best price quote.",
          "any",
        );
      }
      if (requote && isSigningPayloadUnavailableError(message)) {
        return requoteAndPrepare(
          client,
          walletAddress,
          expectedQuote,
          adjustedRequote!,
          "Intent MCP did not return wallet signing data for this quote.",
        );
      }
      if (requote && isOneinchOrderBuildError(message)) {
        return requoteAndPrepare(
          client,
          walletAddress,
          expectedQuote,
          adjustedRequote!,
          "1inch Fusion gasless routing on Ethereum Mainnet is unavailable (feeReceiver missing on Intent MCP).",
          "any",
        );
      }
      if (requote && isSimulationTransferFailedError(message)) {
        return requoteAndPrepare(
          client,
          walletAddress,
          expectedQuote,
          adjustedRequote!,
          "On-chain swap simulation failed before token approval.",
          "gasless",
        );
      }
      if (!isRouteBuildError(message) || !adjustedRequote) throw err;

      return requoteAndPrepare(
        client,
        walletAddress,
        expectedQuote,
        adjustedRequote,
        "Swap route build failed for this quote (Uniswap backend rejected the route payload).",
      );
    }
  });
}

async function prepareSwapOnce(
  client: ReturnType<typeof createIntentMcpSwapClient>,
  quoteId: string,
  walletAddress: string,
  expectedQuote?: ExpectedSwapQuote,
  confirmationSignature?: string,
  options?: {
    acknowledgeUserPaidGas?: boolean;
    quoteExecutionMode?: string;
    quoteRoute?: string;
    quoteRouteType?: string;
    quoteGasEstimateUsd?: number;
    quoteGasless?: boolean;
  },
): Promise<SwapPrepareResult> {
  const acknowledgeUserPaidGas =
    options?.acknowledgeUserPaidGas ??
    quoteRequiresGasAck({
      executionMode: options?.quoteExecutionMode,
      route: options?.quoteRoute,
      routeType: options?.quoteRouteType,
      gasEstimateUsd: options?.quoteGasEstimateUsd,
      gasless: options?.quoteGasless,
    });
  const prepared = (await client.prepareIntent(quoteId, walletAddress, {
    confirmationSignature,
    acknowledgeUserPaidGas: acknowledgeUserPaidGas || undefined,
  })) as PrepareIntentResponse;
  const intentId = extractIntentId(prepared);

  const fetched = await fetchSigningInstructionsWithRetry(client, intentId);

  const signingInstructions = normalizeSigningInstructions(prepared, fetched);
  if (expectedQuote) {
    validateSwapQuoteAgainstInstructions(signingInstructions, expectedQuote);
  }
  return { intentId, signingInstructions, prepare: prepared };
}

export async function fetchSwapSigningInstructions(intentId: string): Promise<SigningInstructions> {
  return withIntentClient(async (client) => {
    const fetched = await client.getSigningInstructions(intentId);
    return normalizeSigningInstructions({ intentId }, fetched);
  });
}

export async function submitSwapSignature(
  intentId: string,
  signed: string,
  walletAddress?: string,
  explicitTxHash?: string,
): Promise<SwapSubmitResult> {
  return withIntentClient(async (client) => {
    const { signature, txHash } = splitWalletResult(signed);
    const raw = (await client.submitSignedIntent(intentId, signature, {
      txHash: explicitTxHash ?? txHash,
      walletAddress,
    })) as SubmitIntentResponse;
    logIntentRaw(
      "intent-swap-execute.ts:submitSwapSignature:response",
      "E",
      intentId,
      raw as Record<string, unknown>,
    );

    if (needsMoreSignatures(raw)) {
      let signingInstructions: SigningInstructions;
      try {
        const fetched = await client.getSigningInstructions(intentId);
        signingInstructions = normalizeSigningInstructions({ intentId }, fetched);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Swap requires a second wallet signature but signing data could not be loaded: ${message}`,
        );
      }

      return {
        intentId,
        status: extractStatus(raw),
        pendingMoreSignatures: true,
        signingInstructions,
        raw,
      };
    }

    let status = extractStatus(raw);
    let resolvedTxHash = extractTxHash(raw);

    if (!status || (!resolvedTxHash && !status)) {
      try {
        const polled = await client.getIntentStatus(intentId);
        status = extractStatus(polled) ?? status;
        resolvedTxHash = extractTxHash(polled) ?? resolvedTxHash;
        return {
          intentId,
          status,
          txHash: resolvedTxHash,
          raw: { ...raw, ...polled },
        };
      } catch {
        /* optional */
      }
    }

    return { intentId, status, txHash: resolvedTxHash, raw };
  });
}

export async function getSwapIntentStatus(intentId: string): Promise<SwapStatusResult> {
  return withIntentClient(async (client) => {
    const raw = await client.getIntentStatus(intentId);
    logIntentRaw("intent-swap-execute.ts:getSwapIntentStatus", "E", intentId, raw);
    const error =
      typeof raw.error === "string"
        ? raw.error
        : typeof raw.failureReason === "string"
          ? raw.failureReason
          : undefined;
    const status = extractStatus(raw);
    const normalized = status?.toLowerCase() ?? "";
    const isCompleted = ["completed", "success", "successful", "filled", "executed"].includes(
      normalized,
    );
    const chainId = typeof raw.fromChain === "number" ? raw.fromChain : undefined;
    let txHash = extractTxHash(raw);
    const orderHash = extractOrderHash(raw);

    if (txHash && chainId != null && !isCompleted) {
      const onChain = await verifyTxOnChain(txHash, chainId);
      if (!onChain.found) {
        txHash = undefined;
      }
    }

    return {
      intentId,
      status,
      txHash,
      orderHash,
      error,
      raw,
    };
  });
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "success",
  "successful",
  "filled",
  "executed",
  "failed",
  "error",
  "reverted",
  "cancelled",
  "canceled",
  "expired",
]);

export async function pollSwapIntentStatus(
  intentId: string,
  options?: { maxAttempts?: number; intervalMs?: number },
): Promise<SwapStatusResult> {
  const maxAttempts = options?.maxAttempts ?? 30;
  const intervalMs = options?.intervalMs ?? 2000;

  let last: SwapStatusResult = { intentId, raw: {} };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await getSwapIntentStatus(intentId);
    const normalized = last.status?.toLowerCase() ?? "";
    if (TERMINAL_STATUSES.has(normalized)) {
      return last;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return last;
}

export async function syncPermitSignerForIntent(
  intentId: string,
  signature: string,
  walletAddress?: string,
): Promise<SwapSubmitResult> {
  return withIntentClient(async (client) => {
    const raw = (await client.syncPermitSigner(intentId, signature, {
      walletAddress,
    })) as SubmitIntentResponse;
    return {
      intentId,
      status: extractStatus(raw),
      txHash: extractTxHash(raw),
      pendingMoreSignatures: needsMoreSignatures(raw),
      raw,
    };
  });
}
