"use client";

import { CollapsibleFooterSection } from "./CollapsibleFooterSection";

const FOLLOW_UP_READ = [
  "Compare gas prices across chains",
  "Latest block on Ethereum",
  "List all Pocket chains",
  "ETH price in USD",
];

const FOLLOW_UP_WALLET = ["What is my wallet balance?"];

export function FollowUpChips({
  onSelect,
  disabled,
  walletConnected,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
  walletConnected?: boolean;
}) {
  const suggestions = [
    ...FOLLOW_UP_READ,
    ...(walletConnected ? FOLLOW_UP_WALLET : []),
  ].slice(0, 4);

  return (
    <CollapsibleFooterSection
      title="Related queries"
      collapsedSummary={suggestions[0]}
      storageKey="pokt-mcp-collapse-related-queries"
      className="animate-fade-in"
    >
      <div
        className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label="Related queries"
      >
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            role="listitem"
            disabled={disabled}
            onClick={() => onSelect(text)}
            className="shrink-0 rounded-full border border-pocket-border/80 bg-pocket-surface px-3 py-1.5 text-xs font-medium text-pocket-foreground shadow-sm transition-all hover:-translate-y-px hover:border-pocket-accent/40 hover:bg-pocket-accent-dim hover:text-pocket-accent disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    </CollapsibleFooterSection>
  );
}
