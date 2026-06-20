"use client";

import type { ThemeMode } from "../lib/theme";
import type { AppSettings } from "../lib/settings";
import type { ChainInfo } from "../lib/api";
import { McpConfigPanel } from "./McpConfigPanel";

export function SettingsDrawer({
  open,
  onClose,
  settings,
  onChange,
  chains,
  apiUrl,
  onClearConversations,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
  chains: ChainInfo[];
  apiUrl: string;
  onClearConversations: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-sm flex-col border-l border-pocket-border bg-pocket-surface shadow-pocket">
        <div className="flex items-center justify-between border-b border-pocket-border px-4 py-3">
          <h2 className="text-lg font-semibold text-pocket-foreground">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-pocket-muted hover:bg-pocket-elevated hover:text-pocket-foreground"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-pocket-muted">
              Default chain
            </label>
            <select
              value={settings.defaultChain}
              onChange={(e) => onChange({ defaultChain: e.target.value })}
              className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 text-sm text-pocket-foreground"
            >
              {chains.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </select>
          </section>

          <section>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-pocket-muted">
              Appearance
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ theme: value as ThemeMode })}
                  className={`rounded-lg border px-2 py-2 text-sm transition-colors ${
                    settings.theme === value
                      ? "border-pocket-accent bg-pocket-accent-dim font-medium text-pocket-accent"
                      : "border-pocket-border bg-pocket-surface text-pocket-muted hover:border-pocket-accent/40 hover:text-pocket-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <Toggle
              label="Expand tool call details by default"
              checked={settings.showToolDetailsExpanded}
              onChange={(v) => onChange({ showToolDetailsExpanded: v })}
            />
            <Toggle
              label="Show advanced RPC panel"
              checked={settings.showAdvancedRpc}
              onChange={(v) => onChange({ showAdvancedRpc: v })}
            />
            <Toggle
              label="Show conversation sidebar"
              checked={settings.sidebarOpen}
              onChange={(v) => onChange({ sidebarOpen: v })}
            />
          </section>

          <section>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-pocket-muted">API URL</p>
            <p className="break-all font-mono text-xs text-pocket-muted">{apiUrl}</p>
          </section>

          <McpConfigPanel />

          <section>
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete all conversations? This cannot be undone.")) {
                  onClearConversations();
                }
              }}
              className="rounded-lg border border-pocket-error-border px-3 py-2 text-sm text-pocket-error transition-colors hover:bg-pocket-error-surface"
            >
              Clear all conversations
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-pocket-foreground">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-pocket-accent" : "bg-pocket-elevated"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-pocket-surface shadow-sm transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}
