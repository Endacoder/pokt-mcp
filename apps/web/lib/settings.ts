import { DEFAULT_WALLET_CHAIN } from "./chain-config";

import type { SwapExecutionMode } from "@pokt-mcp/shared";
import type { ThemeMode } from "./theme";

export type AppSettings = {
  defaultChain: string;
  showToolDetailsExpanded: boolean;
  showAdvancedRpc: boolean;
  sidebarOpen: boolean;
  theme: ThemeMode;
  /** Default Intent MCP execution mode for swap quotes. */
  swapExecutionMode: SwapExecutionMode;
};

const STORAGE_KEY = "pokt-mcp-settings";
const SETTINGS_VERSION = 2;

type StoredSettings = Partial<AppSettings> & { version?: number };

const DEFAULTS: AppSettings = {
  defaultChain: DEFAULT_WALLET_CHAIN,
  showToolDetailsExpanded: false,
  showAdvancedRpc: false,
  sidebarOpen: true,
  theme: "system",
  swapExecutionMode: "any",
};

function migrateSettings(parsed: StoredSettings): AppSettings {
  let merged: AppSettings = { ...DEFAULTS, ...parsed };
  // v2: default swap routing was gasless-only; best-price (any) works for small USDT→ETH.
  if ((parsed.version ?? 1) < 2 && merged.swapExecutionMode === "gasless") {
    merged = { ...merged, swapExecutionMode: "any" };
  }
  return merged;
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as StoredSettings;
    const merged = migrateSettings(parsed);
    if ((parsed.version ?? 1) < SETTINGS_VERSION) {
      saveSettings(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...merged, version: SETTINGS_VERSION }));
    }
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION }));
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial };
  saveSettings(next);
  return next;
}
