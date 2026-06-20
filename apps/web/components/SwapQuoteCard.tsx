"use client";

import { useEffect, useState } from "react";
import { isQuoteExpired, secondsUntilQuoteExpiry } from "../lib/swap-expiry";

type SwapQuoteDisplay = {
  chainName: string;
  chainId?: number;
  amountIn: string;
  tokenIn: string;
  amountInAtomic: string;
  tokenInAddress: string;
  amountOut: string;
  tokenOut: string;
  tokenOutAddress?: string;
  executionMode?: "any" | "gasless" | "gas";
  route: string;
  platformFeeBps: number;
  gasless: boolean;
  gasEstimateUsd?: number;
  priceImpactBps?: number;
  warnings: string[];
  quoteId: string;
  expiresAt: string;
};

function formatExpiresAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SwapQuoteCard({
  display,
  latencyMs,
  walletConnected,
  onConfirm,
}: {
  display: SwapQuoteDisplay;
  latencyMs?: number;
  walletConnected?: boolean;
  onConfirm?: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntilQuoteExpiry(display.expiresAt));
  const expired = isQuoteExpired(display.expiresAt);

  useEffect(() => {
    setSecondsLeft(secondsUntilQuoteExpiry(display.expiresAt));
    const timer = window.setInterval(() => {
      setSecondsLeft(secondsUntilQuoteExpiry(display.expiresAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [display.expiresAt]);

  return (
    <div className="rounded-xl border border-pocket-border bg-pocket-surface px-4 py-3 text-sm shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-pocket-muted">
        Swap quote · {display.chainName}
      </p>
      <p className="mt-2 text-lg font-semibold text-pocket-foreground">
        {display.amountIn} {display.tokenIn}
        <span className="mx-2 font-normal text-pocket-muted">→</span>
        ~{display.amountOut} {display.tokenOut}
      </p>

      <dl className="mt-3 space-y-1.5 text-pocket-foreground">
        <div className="flex justify-between gap-4">
          <dt className="text-pocket-muted">Route</dt>
          <dd className="text-right">{display.route}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pocket-muted">Platform fee</dt>
          <dd className="text-right">
            {display.platformFeeBps} bps ({(display.platformFeeBps / 100).toFixed(2)}%)
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pocket-muted">Execution</dt>
          <dd className="text-right">
            {display.executionMode === "gas"
              ? "Gas (you pay)"
              : display.gasless
                ? "Gasless (solver pays)"
                : "Gasless"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-pocket-muted">Gas</dt>
          <dd className="text-right">
            {display.gasEstimateUsd != null && display.gasEstimateUsd > 0
              ? `~$${display.gasEstimateUsd.toFixed(2)}`
              : display.gasless
                ? "Gasless (solver pays)"
                : "—"}
          </dd>
        </div>
        {display.priceImpactBps != null && (
          <div className="flex justify-between gap-4">
            <dt className="text-pocket-muted">Price impact</dt>
            <dd className="text-right">{(display.priceImpactBps / 100).toFixed(2)}%</dd>
          </div>
        )}
      </dl>

      {display.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700">
          {display.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 font-mono text-xs text-pocket-muted">
        {display.quoteId} · expires {formatExpiresAt(display.expiresAt)}
        {!expired && secondsLeft > 0 && (
          <span className="ml-2 text-amber-700">({secondsLeft}s left)</span>
        )}
        {expired && <span className="ml-2 text-red-600">(expired)</span>}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-pocket-border pt-3">
        <p className="text-xs leading-relaxed text-pocket-muted">
          {expired
            ? "Quote expired — ask for a new swap quote."
            : walletConnected
              ? "Confirm to sign in your wallet. Quotes expire in ~60s."
              : "Connect your wallet to sign and execute this swap."}
        </p>
        {onConfirm && (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-pocket-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pocket-cta-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!walletConnected || expired}
            onClick={onConfirm}
          >
            Sign in wallet
          </button>
        )}
      </div>

      {latencyMs !== undefined && (
        <p className="mt-1 text-xs text-pocket-muted">{latencyMs}ms</p>
      )}
    </div>
  );
}
