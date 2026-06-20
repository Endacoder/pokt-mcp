"use client";

import { useEffect, useState, type ReactNode } from "react";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
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

export function CollapsibleFooterSection({
  title,
  subtitle,
  collapsedSummary,
  storageKey,
  defaultOpen = true,
  titleVariant = "label",
  headerActions,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  collapsedSummary?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  titleVariant?: "label" | "heading";
  headerActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setOpen(stored === "true");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-pocket-border/80 bg-pocket-elevated/40 px-3 py-2 text-left transition-colors hover:border-pocket-accent/30 ${className}`}
        aria-expanded={false}
        aria-label={`Expand ${title}`}
      >
        <div className="min-w-0">
          <p className="text-xs font-medium text-pocket-foreground">{title}</p>
          {collapsedSummary ? (
            <p className="truncate text-[11px] text-pocket-muted">{collapsedSummary}</p>
          ) : null}
        </div>
        <ChevronIcon open={false} />
      </button>
    );
  }

  const titleClass =
    titleVariant === "heading"
      ? "text-xs font-medium text-pocket-foreground"
      : "text-xs font-semibold uppercase tracking-wider text-pocket-muted";

  return (
    <div className={className}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${children ? "mb-2" : ""}`}>
        <div className="min-w-0">
          <p className={titleClass}>{title}</p>
          {subtitle ? <p className="text-[11px] text-pocket-muted">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerActions}
          <button
            type="button"
            onClick={toggle}
            className="shrink-0 rounded-lg p-1 text-pocket-muted hover:bg-pocket-elevated hover:text-pocket-foreground"
            aria-label={`Collapse ${title}`}
            aria-expanded
          >
            <ChevronIcon open />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
