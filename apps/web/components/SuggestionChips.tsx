import {
  FEATURE_SUGGESTIONS,
  READ_SUGGESTIONS,
  WALLET_READ_SUGGESTIONS,
  WRITE_SUGGESTIONS,
  type Suggestion,
} from "../lib/suggestions";
import { BRAND } from "../lib/brand";
import { AgentMark } from "./brand/AgentMark";
import { BrandWordmark } from "./brand/BrandWordmark";

const FEATURES = [
  { label: "Wallet health", desc: "fees & portfolio" },
  { label: "Token research", desc: "holders & volume" },
  { label: "Scam detector", desc: "rug pull scan" },
  { label: "DeFi monitor", desc: "positions & health" },
  { label: "DAO tracker", desc: "proposals & votes" },
  { label: "Node operator", desc: "relays & earnings" },
];

export function SuggestionChips({
  onSelect,
  disabled,
  walletConnected,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
  walletConnected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-8 py-10">
      <div className="animate-float">
        <AgentMark className="h-16 w-16 shadow-pocket-lg" />
      </div>

      <div
        className="pocket-gradient-border animate-fade-in-up w-full max-w-lg rounded-2xl bg-pocket-surface px-8 py-10 text-center shadow-pocket-lg"
        style={{ animationDelay: "0.05s" }}
      >
        <span className="badge-agent">{BRAND.agentLabel} interface</span>
        <div className="mt-3 flex justify-center">
          <BrandWordmark size="lg" />
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-pocket-foreground sm:text-2xl">
          What should the agent{" "}
          <span className="pocket-gradient-text">query</span>?
        </h2>
        <p className="mt-3 max-w-md mx-auto text-sm leading-relaxed text-pocket-muted">
          {BRAND.description}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {FEATURES.map((f, i) => (
            <div
              key={f.label}
              className="animate-fade-in-up rounded-full border border-pocket-border/80 bg-pocket-gradient-subtle px-3 py-1.5 text-xs"
              style={{ animationDelay: `${0.1 + i * 0.06}s` }}
            >
              <span className="font-medium text-pocket-accent">{f.label}</span>
              <span className="text-pocket-muted"> · {f.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full max-w-lg space-y-5">
        <SuggestionGroup
          label="Seven-feature suite"
          delay={0.16}
          suggestions={FEATURE_SUGGESTIONS.filter(
            (s) => !s.requiresWallet || walletConnected,
          )}
          onSelect={onSelect}
          disabled={disabled}
        />
        <SuggestionGroup
          label="Read queries"
          delay={0.2}
          suggestions={[
            ...READ_SUGGESTIONS,
            ...(walletConnected ? WALLET_READ_SUGGESTIONS : []),
          ]}
          onSelect={onSelect}
          disabled={disabled}
        />
        <SuggestionGroup
          label={`Write queries ${walletConnected ? "· wallet connected" : "· connect wallet first"}`}
          delay={0.28}
          suggestions={WRITE_SUGGESTIONS}
          onSelect={onSelect}
          disabled={disabled || !walletConnected}
          muted={!walletConnected}
        />
      </div>
    </div>
  );
}

function SuggestionGroup({
  label,
  suggestions,
  onSelect,
  disabled,
  muted,
  delay = 0,
}: {
  label: string;
  suggestions: Suggestion[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  muted?: boolean;
  delay?: number;
}) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${delay}s` }}>
      <p className="mb-2.5 text-center text-xs font-semibold uppercase tracking-widest text-pocket-muted/80">
        {label}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s, i) => (
          <SuggestionButton
            key={s.text}
            text={s.text}
            icon={s.icon}
            onSelect={onSelect}
            disabled={disabled}
            muted={muted}
            delay={delay + 0.04 * i}
          />
        ))}
      </div>
    </div>
  );
}

function SuggestionButton({
  text,
  icon,
  onSelect,
  disabled,
  muted,
  delay = 0,
}: {
  text: string;
  icon: string;
  onSelect: (text: string) => void;
  disabled?: boolean;
  muted?: boolean;
  delay?: number;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(text)}
      style={{ animationDelay: `${delay}s` }}
      className={`animate-fade-in-up group flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all duration-200 disabled:opacity-50 ${
        muted
          ? "border-pocket-border bg-pocket-elevated/80 text-pocket-muted/60"
          : "border-pocket-border/80 bg-pocket-surface/90 text-pocket-foreground shadow-sm hover:-translate-y-0.5 hover:border-pocket-accent/50 hover:bg-pocket-accent-dim hover:text-pocket-accent hover:shadow-pocket-md"
      }`}
    >
      <span className="text-base leading-none opacity-70 transition-transform group-hover:scale-110" aria-hidden>
        {icon}
      </span>
      <span>{text}</span>
    </button>
  );
}
