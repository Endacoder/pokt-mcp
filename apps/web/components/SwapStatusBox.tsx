"use client";

import { useEffect, useState } from "react";
import { isQuoteExpired, secondsUntilQuoteExpiry } from "../lib/swap-expiry";
import {
  SWAP_STEPS,
  swapPhaseMessage,
  swapStepIndex,
  type SwapFlowState,
  type SwapPhase,
} from "../lib/swap-status";

function SwapIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M7 7h11l-2.5-2.5M18 17H7l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 7V4M8 17v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function stepState(stepIdx: number, activeIdx: number, phase: SwapPhase) {
  if (phase === "done") return "done";
  if (phase === "error" && stepIdx === activeIdx) return "error";
  if (stepIdx < activeIdx) return "done";
  if (stepIdx === activeIdx) return "active";
  return "pending";
}

export function SwapStatusBox({
  flow,
  onOpenConfirm,
  onDismiss,
}: {
  flow: SwapFlowState;
  onOpenConfirm?: () => void;
  onDismiss?: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    secondsUntilQuoteExpiry(flow.display.expiresAt),
  );
  const expired = isQuoteExpired(flow.display.expiresAt);
  const activeIdx = swapStepIndex(flow.phase);
  const inProgress =
    flow.phase === "preparing" ||
    flow.phase === "signing" ||
    flow.phase === "submitting" ||
    flow.phase === "settling";
  const showConfirm =
    (flow.phase === "quoted" || flow.phase === "confirm" || flow.phase === "error") &&
    !expired &&
    onOpenConfirm;

  useEffect(() => {
    setSecondsLeft(secondsUntilQuoteExpiry(flow.display.expiresAt));
    const timer = window.setInterval(() => {
      setSecondsLeft(secondsUntilQuoteExpiry(flow.display.expiresAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [flow.display.expiresAt]);

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm shadow-pocket transition-all ${
        flow.phase === "done"
          ? "border-pocket-success-border bg-pocket-success-surface"
          : flow.phase === "error"
            ? "border-pocket-error-border bg-pocket-error-surface"
            : inProgress
              ? "border-pocket-accent/40 bg-pocket-accent-dim shadow-pocket-glow"
              : "border-pocket-border bg-pocket-surface"
      }`}
      role="status"
      aria-live="polite"
      aria-label="Swap status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              inProgress
                ? "bg-pocket-gradient text-white shadow-pocket-accent animate-pulse-glow"
                : flow.phase === "done"
                  ? "bg-pocket-success text-white"
                  : flow.phase === "error"
                    ? "bg-pocket-error-surface text-pocket-error"
                    : "bg-pocket-accent-dim text-pocket-accent"
            }`}
          >
            {flow.phase === "done" ? (
              <span aria-hidden>✓</span>
            ) : flow.phase === "error" ? (
              <span aria-hidden>!</span>
            ) : (
              <SwapIcon />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-pocket-muted">Swap</p>
            <p className="truncate font-medium text-pocket-foreground">
              {flow.display.amountIn} {flow.display.tokenIn}
              <span className="mx-1 text-pocket-muted">→</span>
              ~{flow.display.amountOut} {flow.display.tokenOut}
            </p>
            <p className="truncate text-xs text-pocket-muted">{flow.display.chainName}</p>
          </div>
        </div>
        {onDismiss && (flow.phase === "done" || flow.phase === "error" || expired) && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg p-1 text-pocket-muted hover:bg-pocket-elevated hover:text-pocket-foreground"
            aria-label="Dismiss swap status"
          >
            ✕
          </button>
        )}
      </div>

      <ol className="mt-3 flex items-center gap-1">
        {SWAP_STEPS.map((step, i) => {
          const state = stepState(i, activeIdx, flow.phase);
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
              <div className="flex min-w-0 flex-col items-center gap-1">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    state === "done"
                      ? "bg-pocket-success text-white"
                      : state === "active"
                        ? "bg-pocket-accent text-white"
                        : state === "error"
                          ? "bg-pocket-error text-white"
                          : "bg-pocket-elevated text-pocket-muted"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={`truncate text-[10px] font-medium ${
                    state === "active" ? "text-pocket-accent" : "text-pocket-muted"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < SWAP_STEPS.length - 1 && (
                <div
                  className={`mb-4 h-px flex-1 ${
                    i < activeIdx || flow.phase === "done" ? "bg-pocket-success" : "bg-pocket-border"
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      <p
        className={`mt-2 text-xs leading-relaxed ${
          flow.phase === "error" ? "text-pocket-error-text" : "text-pocket-muted"
        }`}
      >
        {swapPhaseMessage(flow.phase, flow.error)}
        {flow.txHash && flow.phase === "done" && (
          <span className="mt-1 block font-mono text-[10px] text-pocket-foreground">
            {flow.txHash.slice(0, 10)}…{flow.txHash.slice(-8)}
          </span>
        )}
      </p>

      {!expired && flow.phase !== "done" && secondsLeft > 0 && (
        <p className="mt-1 text-[10px] text-pocket-warning">
          Quote expires in {secondsLeft}s
        </p>
      )}
      {expired && flow.phase !== "done" && (
        <p className="mt-1 text-[10px] text-pocket-error">Quote expired — request a new swap.</p>
      )}

      {showConfirm && (
        <button
          type="button"
          onClick={onOpenConfirm}
          className="mt-3 w-full rounded-lg bg-pocket-gradient py-2 text-xs font-semibold text-white shadow-pocket-accent transition-all hover:brightness-110"
        >
          Open swap confirmation
        </button>
      )}
    </div>
  );
}

/** Compact header chip when a swap is in flight. */
export function SwapStatusChip({
  flow,
  onClick,
}: {
  flow: SwapFlowState;
  onClick?: () => void;
}) {
  const inProgress =
    flow.phase === "preparing" ||
    flow.phase === "signing" ||
    flow.phase === "submitting" ||
    flow.phase === "settling";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        inProgress
          ? "border-pocket-accent/40 bg-pocket-accent-dim text-pocket-accent animate-pulse-glow"
          : flow.phase === "done"
            ? "border-pocket-success-border bg-pocket-success-surface text-pocket-success"
            : "border-pocket-border bg-pocket-surface text-pocket-foreground hover:border-pocket-accent/40"
      }`}
      title={swapPhaseMessage(flow.phase, flow.error)}
      aria-label={`Swap status: ${swapPhaseMessage(flow.phase, flow.error)}`}
    >
      <SwapIcon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">
        {flow.display.tokenIn}→{flow.display.tokenOut}
      </span>
      {inProgress && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pocket-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pocket-accent" />
        </span>
      )}
    </button>
  );
}
