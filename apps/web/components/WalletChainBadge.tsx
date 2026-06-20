"use client";

import type { ChainInfo } from "../lib/api";
import { chainLabelFromSlug, isTestnetChain } from "../lib/chain-config";

export function WalletChainBadge({
  chainSlug,
  chains,
  chainId,
}: {
  chainSlug: string;
  chains: ChainInfo[];
  chainId?: number;
}) {
  const label = chainLabelFromSlug(chainSlug, chains);

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-pocket-border/80 bg-pocket-surface/90 px-3 py-1.5 text-sm text-pocket-foreground shadow-sm backdrop-blur-sm"
      title={chainId != null ? `Chain ID ${chainId}` : undefined}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pocket-cyan opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-pocket-cyan" />
      </span>
      <span className="truncate">{label}</span>
      {isTestnetChain(chainSlug) && (
        <span className="rounded bg-pocket-accent-dim px-1.5 py-0.5 text-[10px] uppercase text-pocket-accent">
          testnet
        </span>
      )}
    </div>
  );
}
