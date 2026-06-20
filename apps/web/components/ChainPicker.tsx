"use client";

import { useEffect, useRef, useState } from "react";
import type { ChainInfo } from "../lib/api";
import { isTestnetChain } from "../lib/chain-config";

export function ChainPicker({
  chains,
  value,
  onChange,
}: {
  chains: ChainInfo[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = chains.find((c) => c.slug === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-pocket-border bg-pocket-surface px-3 py-1.5 text-sm text-pocket-foreground shadow-sm transition-colors hover:border-pocket-accent/30 focus:border-pocket-accent/50 focus:outline-none focus:ring-2 focus:ring-pocket-accent/20"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-pocket-accent" aria-hidden />
        <span className="truncate">{selected?.name ?? value}</span>
        {selected && isTestnetChain(selected.slug) && (
          <span className="rounded bg-pocket-accent-dim px-1.5 py-0.5 text-[10px] uppercase text-pocket-accent">
            testnet
          </span>
        )}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-pocket-muted" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full z-30 mb-1 max-h-60 w-72 overflow-y-auto rounded-xl border border-pocket-border bg-pocket-surface py-1 shadow-pocket"
        >
          {chains.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                role="option"
                aria-selected={c.slug === value}
                onClick={() => {
                  onChange(c.slug);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-pocket-elevated ${
                  c.slug === value
                    ? "bg-pocket-accent-dim text-pocket-accent"
                    : "text-pocket-foreground"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-xs text-pocket-muted">{c.slug}</span>
                {c.chainId != null && (
                  <span className="shrink-0 text-xs text-pocket-muted">{c.chainId}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
