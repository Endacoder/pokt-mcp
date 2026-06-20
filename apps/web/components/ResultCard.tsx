"use client";

import { toDisplayString } from "../lib/format";
import { SwapQuoteCard } from "./SwapQuoteCard";

type RpcIntent = {
  method: string;
  chain: string;
  params?: unknown[];
  humanSummary?: string;
};

type ResultPayload = {
  route?: string;
  intent?: RpcIntent;
  output?: unknown;
  latencyMs?: number;
  requiresConfirmation?: boolean;
  pendingAction?: string;
  message?: string;
};

const resultCardClass =
  "rounded-xl border border-pocket-border/80 bg-pocket-surface/95 px-4 py-3 text-sm shadow-pocket backdrop-blur-sm";

function hexToDecimal(hex: string): string {
  try {
    return BigInt(hex).toString();
  } catch {
    return hex;
  }
}

function weiHexToEth(hex: string): string {
  try {
    const wei = BigInt(hex);
    const eth = Number(wei) / 1e18;
    return eth.toFixed(6).replace(/\.?0+$/, "") || "0";
  } catch {
    return hex;
  }
}

function gweiFromHex(hex: string): string {
  try {
    return (Number(BigInt(hex)) / 1e9).toFixed(2);
  } catch {
    return hex;
  }
}

type SwapQuoteDisplayPayload = Parameters<typeof SwapQuoteCard>[0]["display"];

export function ResultCard({
  data,
  error,
  walletConnected,
  onConfirmSwap,
}: {
  data?: ResultPayload;
  error?: unknown;
  walletConnected?: boolean;
  onConfirmSwap?: (swap: { quoteId: string; display: SwapQuoteDisplayPayload }) => void;
}) {
  if (error) {
    return (
      <div className="surface-error rounded-xl px-4 py-3 text-sm">
        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-pocket-error">Error</p>
        {toDisplayString(error)}
      </div>
    );
  }

  if (!data) return null;

  if (data.requiresConfirmation) {
    return (
      <div className="surface-warning rounded-xl px-4 py-3 text-sm">
        {data.message ?? "Transaction requires wallet confirmation."}
      </div>
    );
  }

  if (data.route === "intent-swap") {
    const display = (data.output as { display?: Record<string, unknown> } | undefined)?.display;
    if (display && typeof display.chainName === "string") {
      return (
        <SwapQuoteCard
          display={display as SwapQuoteDisplayPayload}
          latencyMs={data.latencyMs}
          walletConnected={walletConnected}
          onConfirm={
            onConfirmSwap && typeof display.quoteId === "string"
              ? () =>
                  onConfirmSwap({
                    quoteId: display.quoteId as string,
                    display: display as SwapQuoteDisplayPayload,
                  })
              : undefined
          }
        />
      );
    }
  }

  const intent = data.intent;
  const output = data.output as { result?: unknown; chains?: Array<{ slug: string; name: string; chainId?: number }> } | undefined;
  if (!intent || output === undefined) return null;

  const chain = intent.chain;
  const latency = data.latencyMs !== undefined ? `${data.latencyMs}ms` : undefined;

  if (intent.method === "eth_blockNumber" && typeof output.result === "string") {
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">Latest block on {chain}</p>
        <p className="text-pocket-foreground">#{hexToDecimal(output.result)}</p>
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "eth_getBalance" && typeof output.result === "string") {
    const addr = (intent.params?.[0] as string) ?? "address";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">Balance on {chain}</p>
        <p className="truncate text-xs text-pocket-muted">{addr}</p>
        <p className="text-pocket-foreground">{weiHexToEth(output.result)} native</p>
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "eth_gasPrice" && typeof output.result === "string") {
    const assessment = (output as { gasAssessment?: { levelLabel: string; gwei: number } }).gasAssessment;
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">Gas price on {chain}</p>
        <p className="text-pocket-foreground">{gweiFromHex(output.result)} gwei</p>
        {assessment && (
          <p className="mt-1 text-pocket-muted">
            Currently <span className="font-medium text-pocket-foreground">{assessment.levelLabel}</span>
          </p>
        )}
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (
    (intent.method === "eth_getTransactionByHash" || intent.method === "eth_getTransactionReceipt") &&
    output.result
  ) {
    const tx = output.result as Record<string, unknown>;
    const hash = (tx.hash as string) ?? (intent.params?.[0] as string);
    const status = tx.status !== undefined ? (tx.status === "0x1" ? "success" : "failed") : "pending";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">Transaction on {chain}</p>
        <p className="truncate text-xs text-pocket-muted">{hash}</p>
        <p className="text-pocket-foreground">Status: {status}</p>
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (
    (intent.method === "eth_getTransactionByHash" || intent.method === "eth_getTransactionReceipt") &&
    output.result == null
  ) {
    const notFound = (output as { notFound?: { message?: string; explorerUrl?: string; suggestions?: string[] } })
      .notFound;
    const hash = (intent.params?.[0] as string) ?? "unknown";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">Transaction not found on {chain}</p>
        <p className="truncate text-xs text-pocket-muted">{hash}</p>
        <p className="mt-1 text-sm text-pocket-foreground">
          {notFound?.message ??
            "No transaction was found on this chain. Verify the hash and network, or wait if the transaction is still pending."}
        </p>
        {notFound?.explorerUrl && (
          <a
            href={notFound.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-pocket-accent underline"
          >
            View on block explorer
          </a>
        )}
        {latency && <p className="mt-2 text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "__query_at_time__" && output && typeof output === "object") {
    const hist = output as {
      subject?: string;
      offsetLabel?: string;
      gasGwei?: number;
      balanceNative?: string;
      blockNumber?: string;
      blockTimeIso?: string;
      address?: string;
    };
    const blockNum = hist.blockNumber ? BigInt(hist.blockNumber).toString() : "—";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">
          {hist.subject === "gas" ? "Gas price" : hist.subject === "balance" ? "Balance" : "Block"} on {chain}{" "}
          {hist.offsetLabel ? `(${hist.offsetLabel})` : ""}
        </p>
        {hist.address && <p className="truncate text-xs text-pocket-muted">{hist.address}</p>}
        {hist.subject === "gas" && hist.gasGwei !== undefined && (
          <p className="text-pocket-foreground">{hist.gasGwei.toFixed(2)} gwei</p>
        )}
        {hist.subject === "balance" && hist.balanceNative !== undefined && (
          <p className="text-pocket-foreground">{hist.balanceNative} native</p>
        )}
        {hist.subject === "blockNumber" && <p className="text-pocket-foreground">#{blockNum}</p>}
        {hist.blockTimeIso && <p className="text-xs text-pocket-muted">Block #{blockNum} @ {hist.blockTimeIso}</p>}
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "__native_convert__" && output && typeof output === "object") {
    const conv = output as {
      nativeAmount?: string;
      nativeSymbol?: string;
      convertedAmount?: number;
      rate?: number;
      targetSymbol?: string;
      targetVs?: string;
      address?: string;
    };
    const target = conv.targetSymbol ?? "USD";
    const decimals = conv.targetVs === "usd" ? 2 : 8;
    const formatAmount = (n: number) =>
      decimals <= 2 ? n.toFixed(decimals) : n.toFixed(decimals).replace(/\.?0+$/, "") || "0";
    const formatted = conv.convertedAmount !== undefined ? formatAmount(conv.convertedAmount) : "—";
    const price = conv.rate !== undefined ? formatAmount(conv.rate) : undefined;
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">{target} value on {chain}</p>
        {conv.address && <p className="truncate text-xs text-pocket-muted">{conv.address}</p>}
        <p className="text-pocket-foreground">
          {conv.nativeAmount} {conv.nativeSymbol ?? "native"} ≈ {formatted} {target}
        </p>
        {price !== undefined && (
          <p className="text-xs text-pocket-muted">
            @ {price} {target} / {conv.nativeSymbol ?? "native"}
          </p>
        )}
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }


  if (intent.method === "__price_change_24h__" && output && typeof output === "object") {
    const change = output as {
      symbol?: string;
      changePercent24h?: number;
      currentPriceUsd?: number;
    };
    const pct = change.changePercent24h;
    const sign = pct !== undefined && pct >= 0 ? "+" : "";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">{change.symbol ?? "Asset"} 24h change</p>
        <p className="text-pocket-foreground">
          {pct !== undefined ? `${sign}${pct.toFixed(2)}%` : "—"}
          {change.currentPriceUsd !== undefined && (
            <span className="text-pocket-muted"> · now ${change.currentPriceUsd.toLocaleString()} USD</span>
          )}
        </p>
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "__spot_price__" && output && typeof output === "object") {
    const spot = output as {
      symbol?: string;
      vsSymbol?: string;
      vsCurrency?: string;
      price?: number;
    };
    const vs = spot.vsSymbol ?? "USD";
    const decimals = spot.vsCurrency === "usd" ? 4 : 8;
    const formatted =
      spot.price !== undefined
        ? spot.price.toFixed(decimals).replace(/\.?0+$/, "") || "0"
        : "—";
    return (
      <div className={resultCardClass}>
        <p className="font-medium text-pocket-accent">{spot.symbol ?? "Asset"} spot price</p>
        <p className="text-pocket-foreground">
          {formatted} {vs}
        </p>
        {latency && <p className="text-xs text-pocket-muted">{latency}</p>}
      </div>
    );
  }

  if (intent.method === "__list_chains__" && output.chains) {
    return (
      <div className={resultCardClass}>
        <p className="mb-2 font-medium text-pocket-accent">Pocket chains ({output.chains.length})</p>
        <div className="max-h-40 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-pocket-muted">
                <th className="pb-1">Slug</th>
                <th className="pb-1">Name</th>
                <th className="pb-1">ID</th>
              </tr>
            </thead>
            <tbody>
              {output.chains.slice(0, 20).map((c) => (
                <tr key={c.slug} className="border-t border-pocket-border">
                  <td className="py-0.5 font-mono text-pocket-accent">{c.slug}</td>
                  <td className="py-0.5 text-pocket-foreground">{c.name}</td>
                  <td className="py-0.5 text-pocket-muted">{c.chainId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={resultCardClass}>
      <p className="font-medium text-pocket-accent">{intent.humanSummary ?? intent.method}</p>
      <pre className="mt-1 max-h-32 overflow-auto text-xs text-pocket-muted">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
  );
}
