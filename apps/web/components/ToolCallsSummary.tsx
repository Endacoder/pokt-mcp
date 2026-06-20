"use client";

import { useState } from "react";
import type { ToolCall } from "../lib/types";
import { ToolCallBlock } from "./ToolCallBlock";
import { HIDDEN_TOOL_CALLS, isHiddenToolCall } from "../lib/tool-calls";

export { HIDDEN_TOOL_CALLS, isHiddenToolCall };

export function visibleToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.filter((tc) => !isHiddenToolCall(tc.tool));
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-.02Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ToolCallsSummary({
  toolCalls,
  defaultOpen = false,
}: {
  toolCalls: ToolCall[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const visible = visibleToolCalls(toolCalls);
  if (!visible.length) return null;

  if (visible.length === 1) {
    return <ToolCallBlock toolCall={visible[0]} defaultOpen={defaultOpen} />;
  }

  const label = `Called ${visible.length} tools`;

  return (
    <div className="agent-tool-panel overflow-hidden rounded-xl border border-pocket-border/60 bg-pocket-surface text-sm shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-pocket-muted transition-colors hover:bg-pocket-accent-dim/50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronIcon open={open} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-pocket-border p-2">
          {visible.map((tc, i) => (
            <ToolCallBlock key={`${tc.tool}-${i}`} toolCall={tc} defaultOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}
