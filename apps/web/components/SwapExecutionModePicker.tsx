"use client";

import type { SwapExecutionMode } from "@pokt-mcp/shared";
import { CollapsibleFooterSection } from "./CollapsibleFooterSection";

const OPTIONS: Array<{ value: SwapExecutionMode; label: string; hint: string }> = [
  {
    value: "any",
    label: "Best price",
    hint: "Compare gas and gasless routes",
  },
  {
    value: "gasless",
    label: "Gasless",
    hint: "CoW / solver pays gas",
  },
  {
    value: "gas",
    label: "Gas",
    hint: "Uniswap / LI.FI — you pay network fees",
  },
];

export function SwapExecutionModePicker({
  value,
  onChange,
  disabled,
}: {
  value: SwapExecutionMode;
  onChange: (mode: SwapExecutionMode) => void;
  disabled?: boolean;
}) {
  const active = OPTIONS.find((o) => o.value === value);

  return (
    <CollapsibleFooterSection
      title="Swap execution"
      subtitle="Used when you request a swap quote"
      collapsedSummary={active ? `${active.label} — ${active.hint}` : undefined}
      storageKey="pokt-mcp-collapse-swap-execution"
      titleVariant="heading"
      className="rounded-xl border border-pocket-border/80 bg-pocket-elevated/40 px-3 py-2"
      headerActions={
        <div
          className="flex shrink-0 rounded-lg border border-pocket-border bg-pocket-surface p-0.5"
          role="radiogroup"
          aria-label="Swap execution mode"
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={value === opt.value}
              title={opt.hint}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                value === opt.value
                  ? "bg-pocket-accent text-white shadow-sm"
                  : "text-pocket-muted hover:text-pocket-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    />
  );
}
