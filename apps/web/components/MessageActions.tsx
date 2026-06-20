"use client";

import { useState } from "react";
import type { Message } from "../lib/types";

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
      <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.379 6H4.5Z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
      <path
        fillRule="evenodd"
        d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449.39Zm-1.776-2.899a.75.75 0 0 0 1.449-.39 7 7 0 0 0-11.713-3.14l-.31.31h2.433a.75.75 0 0 0 0 1.5H4.243a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.312.311a5.5 5.5 0 0 0 9.201-2.466.75.75 0 0 0-.39-1.45h-.002Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ThumbUpIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} className="h-3.5 w-3.5" aria-hidden>
      <path
        d="M10 3.5 12.5 8h3.5l-3 6H6l-2.5-6h3.5L10 3.5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbDownIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} className="h-3.5 w-3.5" aria-hidden>
      <path
        d="M10 16.5 7.5 12H4l3-6h7l2.5 6h-3.5L10 16.5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function extractTxHash(message: Message): string | undefined {
  if (message.role !== "assistant" || !message.result) return undefined;
  const output = message.result.output as { result?: unknown } | undefined;
  if (output?.result && typeof output.result === "object") {
    const tx = output.result as Record<string, unknown>;
    if (typeof tx.hash === "string") return tx.hash;
  }
  const content = message.content;
  const match = content.match(/\b0x[a-fA-F0-9]{64}\b/);
  return match?.[0];
}

export function MessageActions({
  message,
  onRetry,
}: {
  message: Message;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  if (message.role !== "assistant") return null;

  async function copyContent() {
    if (message.role !== "assistant") return;
    const parts = [message.content];
    if (message.result) parts.push(JSON.stringify(message.result, null, 2));
    await navigator.clipboard.writeText(parts.filter(Boolean).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyHash() {
    const hash = extractTxHash(message);
    if (hash) {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const txHash = extractTxHash(message);
  const btnClass =
    "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-pocket-muted transition-colors hover:bg-pocket-elevated hover:text-pocket-accent";

  return (
    <div className="flex flex-wrap items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <button type="button" onClick={copyContent} className={btnClass} title="Copy message">
        <CopyIcon />
        {copied ? "Copied" : "Copy"}
      </button>
      {txHash && (
        <button type="button" onClick={copyHash} className={btnClass} title="Copy transaction hash">
          <CopyIcon />
          Hash
        </button>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className={btnClass} title="Regenerate response">
          <RetryIcon />
          Regenerate
        </button>
      )}
      <span className="mx-1 hidden h-3 w-px bg-pocket-border sm:inline" aria-hidden />
      <button
        type="button"
        onClick={() => setFeedback((f) => (f === "up" ? null : "up"))}
        className={`${btnClass} ${feedback === "up" ? "text-pocket-accent" : ""}`}
        title="Good response"
        aria-pressed={feedback === "up"}
      >
        <ThumbUpIcon filled={feedback === "up"} />
      </button>
      <button
        type="button"
        onClick={() => setFeedback((f) => (f === "down" ? null : "down"))}
        className={`${btnClass} ${feedback === "down" ? "text-pocket-error" : ""}`}
        title="Poor response"
        aria-pressed={feedback === "down"}
      >
        <ThumbDownIcon filled={feedback === "down"} />
      </button>
    </div>
  );
}
