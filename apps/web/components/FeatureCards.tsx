"use client";

import type { ComponentType } from "react";

const cardClass =
  "rounded-xl border border-pocket-border/80 bg-pocket-surface/95 px-4 py-3 text-sm shadow-pocket backdrop-blur-sm";

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    low: "text-green-400",
    medium: "text-yellow-400",
    high: "text-orange-400",
    critical: "text-red-400",
    excellent: "text-green-400",
    good: "text-emerald-400",
    fair: "text-yellow-400",
    poor: "text-red-400",
    benign: "text-green-400",
    review: "text-yellow-400",
    suspicious: "text-red-400",
    safe: "text-green-400",
    warning: "text-yellow-400",
    danger: "text-red-400",
  };
  return (
    <span className={`font-semibold uppercase ${colors[level] ?? "text-pocket-muted"}`}>
      {level}
    </span>
  );
}

export function WalletHealthCard({ data }: { data: Record<string, unknown> }) {
  const score = data.healthScore as number | undefined;
  const label = data.healthLabel as string | undefined;
  const gas = data.gasFeesSpentEth as number | undefined;
  const audit = data.audit as { portfolio?: { totalUsd?: number }; findings?: unknown[] } | undefined;
  const recs = data.recommendations as string[] | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">Wallet Health Check</p>
      {score !== undefined && (
        <p className="mt-1 text-2xl font-bold text-pocket-foreground">
          {score}/100 <RiskBadge level={label ?? "fair"} />
        </p>
      )}
      {gas !== undefined && gas > 0 && (
        <p className="mt-1 text-pocket-muted">Gas spent (90d est.): {gas.toFixed(6)} ETH</p>
      )}
      {audit?.portfolio?.totalUsd !== undefined && (
        <p className="text-pocket-foreground">Portfolio: ${audit.portfolio.totalUsd.toFixed(2)} USD</p>
      )}
      {audit?.findings && audit.findings.length > 0 && (
        <p className="mt-1 text-xs text-pocket-muted">{audit.findings.length} security finding(s)</p>
      )}
      {recs && recs.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-pocket-muted">
          {recs.slice(0, 3).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TokenResearchCard({ data }: { data: Record<string, unknown> }) {
  const symbol = data.symbol as string | undefined;
  const spot = data.spotPrice as { price?: number } | undefined;
  const change = data.priceChange7d as { changePercent?: number } | undefined;
  const holders = data.topHolders as Array<{ address: string; sharePercent?: number }> | undefined;
  const safety = data.safetyPreview as { riskLevel?: string } | undefined;
  const vol = data.volume24h as number | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">Token Research — {symbol ?? "Token"}</p>
      {spot?.price !== undefined && (
        <p className="mt-1 text-pocket-foreground">${spot.price.toLocaleString()} USD</p>
      )}
      {change?.changePercent !== undefined && (
        <p className={change.changePercent >= 0 ? "text-green-400" : "text-red-400"}>
          7d: {change.changePercent >= 0 ? "+" : ""}
          {change.changePercent.toFixed(2)}%
        </p>
      )}
      {vol !== undefined && vol > 0 && (
        <p className="text-xs text-pocket-muted">DEX volume 24h: ${vol.toLocaleString()}</p>
      )}
      {safety?.riskLevel && (
        <p className="mt-1 text-xs">
          Safety: <RiskBadge level={safety.riskLevel} />
        </p>
      )}
      {holders && holders.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto text-xs text-pocket-muted">
          {holders.slice(0, 5).map((h) => (
            <p key={h.address} className="truncate">
              {h.address.slice(0, 10)}… {h.sharePercent?.toFixed(1)}%
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ContractExplainerCard({ data }: { data: Record<string, unknown> }) {
  const name = data.contractName as string | undefined;
  const verdict = data.verdict as string | undefined;
  const verified = data.verified as boolean | undefined;
  const isProxy = data.isProxy as boolean | undefined;
  const patterns = data.suspiciousPatterns as string[] | undefined;
  const summary = data.plainEnglishSummary as string | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">Contract Explainer</p>
      {verdict && (
        <p className="mt-1">
          Verdict: <RiskBadge level={verdict} />
          {verified === false && <span className="ml-2 text-xs text-pocket-muted">(unverified)</span>}
        </p>
      )}
      {name && <p className="text-pocket-foreground">{name}</p>}
      {isProxy && <p className="text-xs text-yellow-400">Proxy contract detected</p>}
      {summary && <p className="mt-2 text-xs text-pocket-muted">{summary}</p>}
      {patterns && patterns.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-pocket-muted">
          {patterns.slice(0, 4).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GovernanceCard({ data }: { data: Record<string, unknown> }) {
  const spaceName = data.spaceName as string | undefined;
  const proposals = data.proposals as Array<{ id: string; title: string; state: string; end: number; scores_total: number }> | undefined;
  const votes = data.votes as Array<{ voter: string; vp: number }> | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">DAO & Governance — {spaceName ?? "Snapshot"}</p>
      {proposals && proposals.length > 0 && (
        <div className="mt-2 space-y-2">
          {proposals.slice(0, 4).map((p) => (
            <div key={p.id} className="rounded-lg border border-pocket-border/50 px-2 py-1.5">
              <p className="text-xs font-medium text-pocket-foreground">{p.title}</p>
              <p className="text-xs text-pocket-muted">
                [{p.state}] ends {new Date(p.end * 1000).toLocaleDateString()} · {p.scores_total} VP
              </p>
            </div>
          ))}
        </div>
      )}
      {votes && votes.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-pocket-muted">Top voters</p>
          {votes.slice(0, 5).map((v) => (
            <p key={v.voter} className="truncate text-xs text-pocket-foreground">
              {v.voter.slice(0, 14)}… — {v.vp.toFixed(1)} VP
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScamScanCard({ data }: { data: Record<string, unknown> }) {
  const risk = data.riskLevel as string | undefined;
  const findings = data.findings as Array<{ severity: string; message: string; action?: string }> | undefined;
  const recs = data.recommendations as string[] | undefined;
  const target = data.target as string | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">Scam / Rug Scan</p>
      {target && <p className="truncate text-xs text-pocket-muted">{target}</p>}
      {risk && (
        <p className="mt-1 text-lg">
          Risk: <RiskBadge level={risk} />
        </p>
      )}
      {findings && findings.length > 0 && (
        <ul className="mt-2 max-h-32 overflow-y-auto list-inside list-disc text-xs text-pocket-muted">
          {findings.slice(0, 6).map((f, i) => (
            <li key={`${f.message}-${i}`}>
              [{f.severity}] {f.message}
            </li>
          ))}
        </ul>
      )}
      {recs && recs[0] && <p className="mt-2 text-xs text-pocket-foreground">{recs[0]}</p>}
    </div>
  );
}

export function DefiPositionsCard({ data }: { data: Record<string, unknown> }) {
  const total = data.totalTvlUsd as number | undefined;
  const positions = data.positions as Array<{ protocol: string; usdValue: number; symbol: string }> | undefined;
  const aave = data.aaveHealth as { healthFactor?: number; liquidationRisk?: string } | undefined;
  const warnings = data.warnings as string[] | undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">DeFi Positions</p>
      {total !== undefined && (
        <p className="mt-1 text-xl font-bold text-pocket-foreground">
          ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} TVL
        </p>
      )}
      {aave?.healthFactor !== undefined && (
        <p className="mt-1 text-sm">
          Aave health: {aave.healthFactor.toFixed(2)}{" "}
          {aave.liquidationRisk && <RiskBadge level={aave.liquidationRisk} />}
        </p>
      )}
      {positions && positions.length > 0 && (
        <div className="mt-2 text-xs text-pocket-muted">
          {positions.slice(0, 6).map((p) => (
            <p key={`${p.protocol}-${p.symbol}`}>
              {p.protocol}: ${p.usdValue.toFixed(2)} {p.symbol}
            </p>
          ))}
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <p className="mt-2 text-xs text-yellow-400">{warnings[0]}</p>
      )}
    </div>
  );
}

export function NodeOperatorCard({ data }: { data: Record<string, unknown> }) {
  const addr = data.supplierAddress as string | undefined;
  const supplier = data.supplier as { services?: Array<{ serviceId: string }>; stake?: string } | null | undefined;
  const metrics = data.metrics as { relayRequestsTotal?: number; available?: boolean } | undefined;
  const chains = data.mostProfitableChains as Array<{ serviceId: string; rank: number }> | undefined;

  const stakePokt = supplier?.stake ? (Number(supplier.stake) / 1e6).toFixed(2) : undefined;

  return (
    <div className={cardClass}>
      <p className="font-medium text-pocket-accent">Node Operator Dashboard</p>
      {addr && <p className="truncate text-xs text-pocket-muted">{addr}</p>}
      {supplier && (
        <p className="mt-1 text-pocket-foreground">
          {supplier.services?.length ?? 0} service(s)
          {stakePokt && ` · ${stakePokt} POKT staked`}
        </p>
      )}
      {metrics?.available && metrics.relayRequestsTotal !== undefined && (
        <p className="text-sm text-pocket-muted">Relays: {metrics.relayRequestsTotal.toLocaleString()}</p>
      )}
      {chains && chains.length > 0 && (
        <div className="mt-2 text-xs text-pocket-muted">
          <p className="font-medium">Top services by difficulty</p>
          {chains.slice(0, 4).map((c) => (
            <p key={c.serviceId}>#{c.rank} {c.serviceId}</p>
          ))}
        </div>
      )}
    </div>
  );
}

const FEATURE_METHODS: Record<string, ComponentType<{ data: Record<string, unknown> }>> = {
  __wallet_health__: WalletHealthCard,
  __token_research__: TokenResearchCard,
  __explain_contract__: ContractExplainerCard,
  __governance__: GovernanceCard,
  __scam_scan__: ScamScanCard,
  __defi_positions__: DefiPositionsCard,
  __operator_status__: NodeOperatorCard,
};

export const FEATURE_CARD_METHODS = new Set(Object.keys(FEATURE_METHODS));

export function FeatureResultCard({ method, output }: { method: string; output: unknown }) {
  const Card = FEATURE_METHODS[method];
  if (!Card || !output || typeof output !== "object") return null;
  return <Card data={output as Record<string, unknown>} />;
}
