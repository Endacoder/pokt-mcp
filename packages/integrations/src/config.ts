export function loadExplorerApiKey(): string | undefined {
  return process.env.EXPLORER_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim() || undefined;
}

/** GoPlus app key (alias: GOPLUS_API_KEY). Pair with GOPLUS_APP_SECRET. */
export function loadGoPlusAppKey(): string | undefined {
  return (
    process.env.GOPLUS_APP_KEY?.trim() ||
    process.env.GOPLUS_API_KEY?.trim() ||
    undefined
  );
}

/** GoPlus app secret — required with app key for signed Bearer token auth. */
export function loadGoPlusAppSecret(): string | undefined {
  return (
    process.env.GOPLUS_APP_SECRET?.trim() ||
    process.env.GOPLUS_API_SECRET?.trim() ||
    undefined
  );
}

/** @deprecated Use loadGoPlusAppKey — kept for backward compatibility */
export function loadGoPlusApiKey(): string | undefined {
  return loadGoPlusAppKey();
}

export function loadSnapshotApiKey(): string | undefined {
  return process.env.SNAPSHOT_API_KEY?.trim() || undefined;
}

export function loadDefiLlamaBaseUrl(): string {
  return process.env.DEFILLAMA_API_URL?.trim() || "https://api.llama.fi";
}

export function loadPocketLcdUrl(): string | undefined {
  return process.env.POCKET_LCD_URL?.trim() || undefined;
}

export function loadPocketOperatorMetricsUrl(): string | undefined {
  return process.env.POCKET_OPERATOR_METRICS_URL?.trim() || undefined;
}

export function loadPocketOperatorAddress(): string | undefined {
  return process.env.POCKET_OPERATOR_ADDRESS?.trim() || undefined;
}
