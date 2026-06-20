"use client";

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

export function ThinkingPanel({
  lines,
  active = true,
}: {
  lines: string[];
  active?: boolean;
}) {
  if (lines.length === 0 && !active) return null;

  const visible = lines.slice(-8);

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
      <ul className="max-h-40 space-y-1 overflow-y-auto px-3 py-2">
        {visible.map((line, i) => (
          <li
            key={`${i}-${line}`}
            className={`font-mono text-xs leading-relaxed ${
              i === visible.length - 1 && active ? "text-pocket-violet" : "text-pocket-muted"
            }`}
          >
            {line}
          </li>
        ))}
        {active && lines.length === 0 && (
          <li className="font-mono text-xs text-pocket-muted">Starting…</li>
        )}
      </ul>
    </div>
  );
}
