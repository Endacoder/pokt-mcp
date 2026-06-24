"use client";

import { useEffect, useRef } from "react";
import { AGENT_STATES } from "../lib/brand";

function SpinnerIcon() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin text-pocket-violet" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/** Keep scroll pinned to the newest content while streaming. */
function scrollToBottom(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}

export function ThinkingPanel({
  lines,
  reasoning,
  active = true,
}: {
  lines: string[];
  reasoning?: string;
  active?: boolean;
}) {
  const hasReasoning = Boolean(reasoning?.trim());
  const reasoningScrollRef = useRef<HTMLPreElement>(null);
  const linesScrollRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (active && hasReasoning) scrollToBottom(reasoningScrollRef.current);
  }, [reasoning, active, hasReasoning]);

  useEffect(() => {
    if (!active) return;
    scrollToBottom(linesScrollRef.current);
  }, [lines, active]);

  if (lines.length === 0 && !hasReasoning && !active) return null;

  return (
    <div
      className="agent-thinking-panel overflow-hidden rounded-xl border border-pocket-border/60 bg-pocket-surface text-sm shadow-sm"
      aria-live="polite"
      aria-label="Agent processing status"
    >
      <div className="flex items-center gap-2 border-b border-pocket-border/50 bg-pocket-violet-dim px-3 py-2 text-xs font-semibold uppercase tracking-widest text-pocket-violet">
        {active && <SpinnerIcon />}
        <span>{active ? AGENT_STATES.thinking.label : AGENT_STATES.done.label}</span>
      </div>

      {hasReasoning && (
        <div className="border-b border-pocket-border/40 bg-pocket-elevated/40 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-pocket-muted">
            Reasoning
          </p>
          <pre
            ref={reasoningScrollRef}
            className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-pocket-foreground/90"
          >
            {reasoning}
            {active && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-pocket-violet align-middle" />
            )}
          </pre>
        </div>
      )}

      <ul ref={linesScrollRef} className="max-h-40 space-y-1 overflow-y-auto px-3 py-2">
        {lines.map((line, i) => (
          <li
            key={`${i}-${line}`}
            className={`font-mono text-xs leading-relaxed ${
              i === lines.length - 1 && active ? "text-pocket-violet" : "text-pocket-muted"
            }`}
          >
            {line}
          </li>
        ))}
        {active && lines.length === 0 && !hasReasoning && (
          <li className="font-mono text-xs text-pocket-muted">Starting…</li>
        )}
      </ul>
    </div>
  );
}
