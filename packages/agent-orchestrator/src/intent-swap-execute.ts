import { loadIntentMcpConfig } from "@pokt-mcp/shared";
import { createIntentMcpSwapClient } from "./intent-mcp-client.js";
import {
  extractIntentId,
  isRouteBuildError,
  normalizeSigningInstructions,
  validatePermitAgainstQuote,
  type ExpectedPermit,
  type PrepareIntentResponse,
  type SigningInstructions,
  type SubmitIntentResponse,
  type SwapRequoteParams,
} from "./intent-swap-types.js";

export type SwapPrepareResult = {
  intentId: string;
  signingInstructions: SigningInstructions;
  prepare: PrepareIntentResponse;
};

export type SwapSubmitResult = {
  intentId: string;
  status?: string;
  txHash?: string;
  raw: SubmitIntentResponse;
};

export async function prepareSwapForSigning(
  quoteId: string,
  walletAddress: string,
  expectedPermit?: ExpectedPermit,
  requote?: SwapRequoteParams,
): Promise<SwapPrepareResult> {
  const config = loadIntentMcpConfig();
  if (!config) {
    throw new Error("INTENT_MCP_NOT_CONFIGURED: set INTENT_MCP_API_KEY on the API server");
  }

  const client = createIntentMcpSwapClient(config);
  try {
    return await prepareSwapOnce(client, quoteId, walletAddress, expectedPermit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isRouteBuildError(message) || !requote) throw err;

    const freshQuote = await client.getSwapQuote({
      fromChain: requote.fromChain,
      toChain: requote.toChain,
      tokenIn: requote.tokenIn,
      tokenOut: requote.tokenOut,
      amount: requote.amount,
      slippageBps: requote.slippageBps ?? 300,
      swapType: "EXACT_INPUT",
      walletAddress,
      executionMode: requote.executionMode ?? "any",
    });

    try {
      return await prepareSwapOnce(client, freshQuote.quoteId, walletAddress, expectedPermit);
    } catch (retryErr) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `Swap route build failed for this quote (Uniswap backend rejected the route payload). ` +
          `A fresh re-quote was attempted but also failed: ${retryMessage}. ` +
          `Request a new swap quote with your wallet connected, then confirm within 60 seconds.`,
      );
    }
  } finally {
    await client.close();
  }
}

async function prepareSwapOnce(
  client: ReturnType<typeof createIntentMcpSwapClient>,
  quoteId: string,
  walletAddress: string,
  expectedPermit?: ExpectedPermit,
): Promise<SwapPrepareResult> {
  const prepared = (await client.prepareIntent(quoteId, walletAddress)) as PrepareIntentResponse;
  const intentId = extractIntentId(prepared);

  let fetched: SigningInstructions | undefined;
  try {
    fetched = await client.getSigningInstructions(intentId);
  } catch {
    /* prepare may include instructions inline */
  }

  const signingInstructions = normalizeSigningInstructions(prepared, fetched);
  if (expectedPermit) {
    validatePermitAgainstQuote(signingInstructions, expectedPermit);
  }
  return { intentId, signingInstructions, prepare: prepared };
}

export async function submitSwapSignature(
  intentId: string,
  signature: string,
): Promise<SwapSubmitResult> {
  const config = loadIntentMcpConfig();
  if (!config) {
    throw new Error("INTENT_MCP_NOT_CONFIGURED: set INTENT_MCP_API_KEY on the API server");
  }

  const client = createIntentMcpSwapClient(config);
  try {
    const raw = (await client.submitSignedIntent(intentId, signature)) as SubmitIntentResponse;
    const txHash =
      typeof raw.txHash === "string"
        ? raw.txHash
        : typeof raw.transactionHash === "string"
          ? raw.transactionHash
          : undefined;

    let status = typeof raw.status === "string" ? raw.status : undefined;
    if (!status) {
      try {
        const polled = await client.getIntentStatus(intentId);
        if (typeof polled.status === "string") status = polled.status;
        if (!txHash && typeof polled.txHash === "string") {
          return {
            intentId,
            status,
            txHash: polled.txHash as string,
            raw: { ...raw, ...polled },
          };
        }
      } catch {
        /* optional */
      }
    }

    return { intentId, status, txHash, raw };
  } finally {
    await client.close();
  }
}
