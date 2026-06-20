"use client";

import { useState } from "react";
import {
  prepareSwap,
  submitSwap,
  SwapApiError,
  type SwapQuoteDisplay,
} from "../lib/swap-api";
import { signSwapInstructions } from "../lib/swap-sign";
import { isQuoteExpired } from "../lib/swap-expiry";

type Phase = "confirm" | "preparing" | "signing" | "submitting" | "done" | "error";

export function SwapConfirmModal({
  display,
  quoteId,
  apiUrl,
  walletAddress,
  chainId,
  onClose,
  onComplete,
  onPhaseChange,
}: {
  display: SwapQuoteDisplay;
  quoteId: string;
  apiUrl: string;
  walletAddress?: string;
  chainId?: number;
  onClose: () => void;
  onComplete: (result: { txHash?: string; status?: string; intentId?: string }) => void;
  onPhaseChange?: (phase: Phase) => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState<string>();
  const [txHash, setTxHash] = useState<string>();
  const quoteExpired = isQuoteExpired(display.expiresAt);
  const canRetry = phase === "confirm" || (phase === "error" && error !== "expired");

  function setSwapPhase(next: Phase) {
    setPhase(next);
    onPhaseChange?.(next);
  }

  async function handleConfirm() {
    if (!walletAddress || !window.ethereum) {
      setError("Connect your wallet before confirming a swap.");
      setSwapPhase("error");
      return;
    }

    if (isQuoteExpired(display.expiresAt)) {
      setError("expired");
      setSwapPhase("error");
      return;
    }

    setError(undefined);
    setSwapPhase("preparing");

    try {
      if (chainId != null) {
        const hexChain = `0x${chainId.toString(16)}`;
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexChain }],
          });
        } catch {
          /* user may already be on chain */
        }
      }

      const expectedPermit =
        display.amountInAtomic && display.tokenInAddress
          ? { tokenAddress: display.tokenInAddress, amountAtomic: display.amountInAtomic }
          : undefined;

      const requote =
        display.chainId && display.tokenInAddress && display.tokenOutAddress && display.amountInAtomic
          ? {
              fromChain: display.chainId,
              toChain: display.chainId,
              tokenIn: display.tokenInAddress,
              tokenOut: display.tokenOutAddress,
              amount: display.amountInAtomic,
              slippageBps: 300,
              executionMode: display.executionMode,
            }
          : undefined;

      const { intentId, signingInstructions } = await prepareSwap(
        apiUrl,
        quoteId,
        walletAddress,
        expectedPermit,
        requote,
      );

      setSwapPhase("signing");
      const signature = await signSwapInstructions(signingInstructions, walletAddress, expectedPermit);

      setSwapPhase("submitting");
      const result = await submitSwap(apiUrl, intentId, signature, {
        tokenIn: display.tokenIn,
        tokenOut: display.tokenOut,
        amountIn: display.amountIn,
        chainName: display.chainName,
      });

      setTxHash(result.txHash);
      setSwapPhase("done");
      onComplete({ txHash: result.txHash, status: result.status, intentId: result.intentId });
    } catch (err) {
      const rejected =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: number }).code === 4001;
      if (rejected) {
        setError("Wallet signature cancelled. You can try again while the quote is still valid.");
      } else if (err instanceof SwapApiError && err.code === "SIGNING_PAYLOAD_UNAVAILABLE") {
        setError(
          "Could not build wallet signing data for this route. Request a new quote and try again.",
        );
      } else if (err instanceof SwapApiError && err.code === "QUOTE_EXPIRED") {
        setError("expired");
      } else if (err instanceof SwapApiError && err.code === "ROUTE_BUILD_FAILED") {
        setError(
          `${err.message} Request a fresh swap quote with your wallet connected first.`,
        );
      } else if (err instanceof SwapApiError && err.code === "PERMIT_AMOUNT_MISMATCH") {
        setError(`${err.message} Request a new quote — do not approve the wallet prompt.`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSwapPhase("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-2xl border border-pocket-border bg-pocket-surface p-5 shadow-xl"
        role="dialog"
        aria-labelledby="swap-confirm-title"
      >
        <h2 id="swap-confirm-title" className="text-lg font-semibold text-pocket-foreground">
          Confirm swap
        </h2>
        <p className="mt-2 text-sm text-pocket-muted">{display.chainName}</p>
        <p className="mt-1 text-xl font-semibold text-pocket-foreground">
          {display.amountIn} {display.tokenIn}
          <span className="mx-2 font-normal text-pocket-muted">→</span>
          ~{display.amountOut} {display.tokenOut}
        </p>

        {phase === "confirm" && !quoteExpired && (
          <p className="mt-3 text-sm text-pocket-muted">
            Your wallet will prompt you to sign. Quotes expire in ~60 seconds — confirm promptly.
          </p>
        )}
        {quoteExpired && (
          <p className="mt-3 text-sm text-red-600">
            This quote has expired. Close and request a new swap quote.
          </p>
        )}

        {phase === "preparing" && (
          <p className="mt-3 text-sm text-pocket-accent">Preparing intent with Intent MCP…</p>
        )}
        {phase === "signing" && (
          <p className="mt-3 text-sm text-pocket-accent">Check your wallet to sign the swap…</p>
        )}
        {phase === "submitting" && (
          <p className="mt-3 text-sm text-pocket-accent">Submitting signed intent…</p>
        )}
        {phase === "done" && (
          <p className="mt-3 text-sm text-green-700">
            Swap submitted{txHash ? `: ${txHash.slice(0, 10)}…${txHash.slice(-8)}` : ""}.
          </p>
        )}
        {phase === "error" && error && error !== "expired" && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        {phase === "error" && error === "expired" && (
          <p className="mt-3 text-sm text-red-600">
            This quote expired (~60s limit). Close this dialog, request a fresh swap quote, and confirm
            immediately.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-pocket-border px-3 py-2 text-sm text-pocket-muted transition-colors hover:bg-pocket-elevated"
            onClick={onClose}
            disabled={phase === "preparing" || phase === "signing" || phase === "submitting"}
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {canRetry && !quoteExpired ? (
            <button
              type="button"
              className="rounded-lg bg-pocket-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-pocket-cta-hover disabled:opacity-50"
              disabled={!walletAddress}
              onClick={handleConfirm}
            >
              Sign in wallet
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
