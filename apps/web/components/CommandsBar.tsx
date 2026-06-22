"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commandHandle,
  filterMcpCommands,
  groupCommandsByCategory,
  MCP_COMMAND_CATEGORIES,
  type McpCommand,
} from "../lib/mcp-commands";

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CommandList({
  commands,
  activeIndex,
  onSelect,
  onHover,
}: {
  commands: McpCommand[];
  activeIndex: number;
  onSelect: (cmd: McpCommand) => void;
  onHover: (index: number) => void;
}) {
  const grouped = groupCommandsByCategory(commands);
  let flatIndex = 0;

  return (
    <div className="max-h-[min(420px,50vh)] overflow-y-auto py-1">
      {grouped.map(([category, items]) => (
        <div key={category}>
          <p className="sticky top-0 z-10 bg-pocket-surface/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-pocket-muted backdrop-blur-sm">
            {MCP_COMMAND_CATEGORIES[category]}
          </p>
          <ul>
            {items.map((cmd) => {
              const index = flatIndex++;
              const active = index === activeIndex;
              return (
                <li key={cmd.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onSelect(cmd)}
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
                      active ? "bg-pocket-accent-dim" : "hover:bg-pocket-elevated/80"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <code className="rounded bg-pocket-elevated px-1.5 py-0.5 font-mono text-[11px] text-pocket-accent">
                        @{cmd.tool}
                      </code>
                      <span className="text-sm font-medium text-pocket-foreground">{cmd.label}</span>
                    </span>
                    <span className="text-xs text-pocket-muted">{cmd.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CommandsBar({
  onInsertCommand,
  disabled,
  walletConnected,
  chain,
}: {
  /** Insert @tool handle into chat input and focus composer for user to finish typing. */
  onInsertCommand: (cmd: McpCommand) => void;
  disabled?: boolean;
  walletConnected?: boolean;
  chain?: string;
}) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => filterMcpCommands(query, { walletConnected, chain }),
    [query, walletConnected, chain],
  );

  const panelOpen = menuOpen || query.length > 0;

  const closePanel = useCallback(() => {
    setMenuOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const insertCommand = useCallback(
    (cmd: McpCommand) => {
      closePanel();
      onInsertCommand(cmd);
    },
    [closePanel, onInsertCommand],
  );

  const confirmSelection = useCallback(() => {
    if (filtered[activeIndex]) {
      insertCommand(filtered[activeIndex]);
    }
  }, [filtered, activeIndex, insertCommand]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, menuOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        if (!query) setActiveIndex(0);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setMenuOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      inputRef.current?.blur();
      return;
    }
    if (!panelOpen || filtered.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        closePanel();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      confirmSelection();
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 max-w-2xl">
      <div className="relative min-w-0">
        <div className="flex items-center gap-2 rounded-xl border border-pocket-border/80 bg-pocket-surface/90 px-3 py-1.5 shadow-sm transition-shadow focus-within:border-pocket-accent/50 focus-within:shadow-pocket">
          <span className="text-pocket-muted">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setMenuOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search MCP commands…"
            aria-label="Search MCP commands"
            aria-autocomplete="list"
            aria-controls="mcp-commands-listbox"
            aria-expanded={panelOpen}
            aria-haspopup="listbox"
            className="min-w-0 flex-1 bg-transparent text-sm text-pocket-foreground placeholder:text-pocket-muted focus:outline-none disabled:opacity-50"
          />
          <kbd className="hidden shrink-0 rounded border border-pocket-border bg-pocket-elevated px-1.5 py-0.5 font-mono text-[10px] text-pocket-muted sm:inline">
            ⌘K
          </kbd>
        </div>

        {panelOpen && filtered.length > 0 && (
          <div
            id="mcp-commands-listbox"
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-pocket-border bg-pocket-surface shadow-pocket-lg"
          >
            <CommandList
              commands={filtered}
              activeIndex={activeIndex}
              onSelect={insertCommand}
              onHover={setActiveIndex}
            />
            <p className="border-t border-pocket-border px-3 py-2 text-[10px] text-pocket-muted">
              {filtered.length} MCP tool{filtered.length === 1 ? "" : "s"} · Enter to insert · ↑↓ navigate
            </p>
          </div>
        )}

        {panelOpen && query && filtered.length === 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-pocket-border bg-pocket-surface px-3 py-4 text-sm text-pocket-muted shadow-pocket-lg">
            No matching commands.
          </div>
        )}
      </div>
    </div>
  );
}

export { commandHandle };
