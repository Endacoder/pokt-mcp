import { resolveChain } from "@pokt-mcp/pocket-client";
import type { IntentMcpConfig, SessionContext, SwapExecutionMode } from "@pokt-mcp/shared";
import { createIntentMcpSwapClient, type SanitizedQuote, type TokenHit } from "./intent-mcp-client.js";
import type { AgentEvent } from "./types.js";

export interface ParsedSwapQuery {
  amountHuman: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  chainHint?: string;
}

export function parseSwapExecutionQuery(query: string): ParsedSwapQuery | null {
  const m = query.trim().match(
    /\b(?:swap|trade|exchange)\s+([\d.,]+)\s+([a-zA-Z0-9]+)\s+(?:for|to|into)\s+([a-zA-Z0-9]+)(?:\s+on\s+([\w-]+))?/i,
  );
  if (!m) return null;
  return {
    amountHuman: m[1].replace(/,/g, ""),
    tokenInSymbol: m[2],
    tokenOutSymbol: m[3],
    chainHint: m[4],
  };
}

type SwapParsePartial = {
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  chainHint?: string;
  missing: "amount" | "source_and_amount";
};

function analyzePartialSwapQuery(query: string): SwapParsePartial | null {
  if (parseSwapExecutionQuery(query)) return null;

  const q = query.trim();

  const withTokens = q.match(
    /\b(?:swap|trade|exchange)\s+(?:my\s+)?([a-zA-Z0-9]+)\s+(?:for|to|into)\s+([a-zA-Z0-9]+)(?:\s+on\s+([\w-]+))?/i,
  );
  if (withTokens && !/^[\d.,]+$/.test(withTokens[1])) {
    return {
      tokenInSymbol: withTokens[1],
      tokenOutSymbol: withTokens[2],
      chainHint: withTokens[3],
      missing: "amount",
    };
  }

  const toOnly = q.match(
    /\b(?:swap|trade|exchange)\s+(?:to|into)\s+([a-zA-Z0-9]+)(?:\s+on\s+([\w-]+))?/i,
  );
  if (toOnly) {
    return {
      tokenOutSymbol: toOnly[1],
      chainHint: toOnly[2],
      missing: "source_and_amount",
    };
  }

  return null;
}

export function formatSwapParseFailureMessage(
  query: string,
  session?: SessionContext,
): string {
  const partial = analyzePartialSwapQuery(query);
  const defaultHint =
    'Try: "swap 1 ETH to USDT" or "swap 50 USDC to ETH on Base".';

  if (!partial) {
    return `Could not parse swap request. ${defaultHint}`;
  }

  const chainSlug = partial.chainHint
    ? resolveChain(partial.chainHint)?.slug
    : session?.defaultChain
      ? resolveChain(session.defaultChain)?.slug
      : "eth";
  const nativeSymbol =
    (chainSlug ? resolveChain(chainSlug)?.nativeSymbol : undefined) ?? "ETH";

  if (partial.missing === "amount" && partial.tokenInSymbol && partial.tokenOutSymbol) {
    const tokenIn = partial.tokenInSymbol.toUpperCase();
    const tokenOut = partial.tokenOutSymbol.toUpperCase();
    return `How much ${tokenIn} do you want to swap to ${tokenOut}? Example: swap 1 ${tokenIn} to ${tokenOut}`;
  }

  if (partial.missing === "source_and_amount" && partial.tokenOutSymbol) {
    const tokenOut = partial.tokenOutSymbol.toUpperCase();
    return `How much do you want to swap to ${tokenOut}? Example: swap 1 ${nativeSymbol} to ${tokenOut}`;
  }

  return `Could not parse swap request. ${defaultHint}`;
}

/** Map user-facing symbols to Intent MCP search queries (wrapped/native variants). */
export function resolveSwapExecutionMode(session: SessionContext): SwapExecutionMode {
  return session.swapExecutionMode ?? "any";
}

export function executionModeLabel(mode: SwapExecutionMode): string {
  if (mode === "any") return "Best price (auto)";
  return mode === "gasless" ? "Gasless (solver pays gas)" : "Gas (you pay network fees)";
}

export function resolveSwapTokenSearchQuery(symbol: string): string {
  switch (symbol.toLowerCase()) {
    case "eth":
      return "WETH";
    case "pol":
    case "matic":
      return "WMATIC";
    default:
      return symbol;
  }
}

export function formatIntentMcpQuoteError(
  err: unknown,
  context: {
    chainName?: string;
    amountHuman?: string;
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    tokenIn?: TokenHit;
    tokenOut?: TokenHit;
    transportLabel?: string;
    transport?: IntentMcpConfig["transport"];
  },
): string {
  const message = err instanceof Error ? err.message : String(err);
  const details: string[] = [];

  if (context.chainName && context.amountHuman && context.tokenInSymbol && context.tokenOutSymbol) {
    details.push(
      `Attempted: ${context.amountHuman} ${context.tokenInSymbol} → ${context.tokenOutSymbol} on ${context.chainName}`,
    );
  }
  if (context.tokenIn && context.tokenOut) {
    details.push(
      `Resolved: ${context.tokenIn.symbol} (${context.tokenIn.address}) → ${context.tokenOut.symbol} (${context.tokenOut.address})`,
    );
  }

  let guidance = "";
  if (/no quotes available/i.test(message)) {
    guidance =
      " Intent MCP has no route for this pair. Swap liquidity is currently strongest on Ethereum, Base, Arbitrum, and Polygon for ETH/USDC/USDT/DAI. On Base use USDC (not USDT); on Polygon use MATIC (not POL). Cross-chain swaps are not supported in web chat yet.";
    if (/no gasless routes/i.test(message)) {
      guidance +=
        " Try execution mode “Best price” or “Gas” in settings — small USDT amounts often fail gasless-only routing.";
    }
  }

  const transportHint =
    context.transport === "mcp-remote"
      ? ` Connected via remote MCP at ${context.transportLabel} (same as Cursor mcp-remote).`
      : " Check INTENT_MCP_API_URL (Intent REST API, e.g. http://127.0.0.1:3101) or unset it to use INTENT_MCP_REMOTE_URL.";

  const detailBlock = details.length ? ` ${details.join(" ")}.` : "";
  return `Intent MCP quote failed: ${message}.${detailBlock}${guidance}${transportHint}`;
}

const KNOWN_EVM_DECIMALS: Record<string, number> = {
  eth: 18,
  weth: 18,
  usdc: 6,
  usdt: 6,
  dai: 18,
};

export function normalizeSwapTokenHit(hit: TokenHit, requestedSymbol: string): TokenHit {
  const known =
    KNOWN_EVM_DECIMALS[requestedSymbol.toLowerCase()] ??
    KNOWN_EVM_DECIMALS[hit.symbol.toLowerCase()];
  if (known != null && hit.decimals !== known) {
    return { ...hit, decimals: known };
  }
  return hit;
}

function humanToAtomic(human: string, decimals: number): string {
  const [wholeRaw, fracRaw = ""] = human.split(".");
  const whole = wholeRaw.replace(/[^\d]/g, "") || "0";
  const frac = fracRaw.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  return (BigInt(whole) * scale + BigInt(frac || "0")).toString();
}

function atomicToHuman(atomic: string, decimals: number): string {
  const negative = atomic.startsWith("-");
  const digits = negative ? atomic.slice(1) : atomic;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;
}

/** Trim long fractional amounts for chat display (e.g. 0.000577461683387887 → 0.00057746). */
function formatSwapAmount(human: string, maxDecimals = 8): string {
  const n = parseFloat(human);
  if (!Number.isFinite(n)) return human;
  if (n === 0) return "0";
  if (n >= 1) {
    return n
      .toFixed(4)
      .replace(/\.?0+$/, "")
      .replace(/\.$/, "");
  }
  const trimmed = n.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return trimmed || "0";
}

function displayTokenSymbol(requested: string, resolved: TokenHit): string {
  const req = requested.toLowerCase();
  const sym = resolved.symbol.toUpperCase();
  if (req === "eth" && sym === "WETH") return "ETH";
  return resolved.symbol;
}

function resolveSwapChainSlug(parsed: ParsedSwapQuery, session: SessionContext): string | null {
  if (parsed.chainHint) {
    const info = resolveChain(parsed.chainHint);
    if (info) return info.slug;
  }
  if (session.defaultChain) {
    const info = resolveChain(session.defaultChain);
    if (info?.chainId) return info.slug;
  }
  return "eth";
}

function formatQuoteExpiresAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function filterSwapWarnings(warnings: string[], gasless: boolean): string[] {
  return warnings.filter((w) => {
    if (gasless && /gasless|fillers\/solvers pay/i.test(w)) return false;
    if (/quote expires in 60 seconds/i.test(w)) return false;
    return true;
  });
}

export type SwapQuoteDisplay = {
  chainName: string;
  chainId: number;
  amountIn: string;
  tokenIn: string;
  amountInAtomic: string;
  tokenInAddress: string;
  amountOut: string;
  tokenOut: string;
  tokenOutAddress: string;
  route: string;
  platformFeeBps: number;
  gasless: boolean;
  gasEstimateUsd?: number;
  priceImpactBps?: number;
  warnings: string[];
  quoteId: string;
  expiresAt: string;
  executionMode: SwapExecutionMode;
};

export function buildSwapQuoteDisplay(
  parsed: ParsedSwapQuery,
  tokenIn: TokenHit,
  tokenOut: TokenHit,
  quote: SanitizedQuote,
  chainName: string,
): SwapQuoteDisplay {
  const gasless = quote.executionMode === "gasless";
  const executionMode: SwapExecutionMode = gasless ? "gasless" : "gas";
  return {
    chainName,
    chainId: quote.fromChain,
    amountIn: formatSwapAmount(atomicToHuman(quote.tokenIn.amount, tokenIn.decimals)),
    tokenIn: displayTokenSymbol(parsed.tokenInSymbol, tokenIn),
    amountInAtomic: quote.tokenIn.amount,
    tokenInAddress: quote.tokenIn.address,
    amountOut: formatSwapAmount(atomicToHuman(quote.tokenOut.amountEstimated, tokenOut.decimals)),
    tokenOut: displayTokenSymbol(parsed.tokenOutSymbol, tokenOut),
    tokenOutAddress: quote.tokenOut.address,
    route: quote.route,
    platformFeeBps: quote.platformFeeBps,
    gasless,
    gasEstimateUsd: quote.gasEstimateUsd,
    priceImpactBps: quote.priceImpactBps,
    warnings: filterSwapWarnings(quote.warnings, gasless),
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt,
    executionMode,
  };
}

export function formatQuoteAnswer(
  parsed: ParsedSwapQuery,
  tokenIn: TokenHit,
  tokenOut: TokenHit,
  quote: SanitizedQuote,
  chainName: string,
): string {
  const d = buildSwapQuoteDisplay(parsed, tokenIn, tokenOut, quote, chainName);
  const bullets: string[] = [
    `- **Route:** ${d.route}`,
    `- **Execution:** ${executionModeLabel(d.executionMode)}`,
    `- **Platform fee:** ${d.platformFeeBps} bps (${(d.platformFeeBps / 100).toFixed(2)}%)`,
  ];

  if (d.gasEstimateUsd != null && d.gasEstimateUsd > 0) {
    bullets.push(`- **Gas:** ~$${d.gasEstimateUsd.toFixed(2)}`);
  } else if (d.gasless) {
    bullets.push("- **Gas:** Gasless (solver pays network fees)");
  }

  if (d.priceImpactBps != null) {
    bullets.push(`- **Price impact:** ${(d.priceImpactBps / 100).toFixed(2)}%`);
  }

  for (const warning of d.warnings) {
    bullets.push(`- ⚠ ${warning}`);
  }

  return [
    `### Swap quote · ${d.chainName}`,
    "",
    `**${d.amountIn} ${d.tokenIn}** → **~${d.amountOut} ${d.tokenOut}**`,
    "",
    ...bullets,
    "",
    `Quote \`${d.quoteId}\` · expires ${formatQuoteExpiresAt(d.expiresAt)}`,
    "",
    "> To execute: click **Sign in wallet** (connect first if needed). Quotes expire in ~60s.",
  ].join("\n");
}

export async function* runIntentSwapRoute(
  query: string,
  sessionContext: SessionContext,
  config: IntentMcpConfig,
): AsyncGenerator<AgentEvent> {
  const parsed = parseSwapExecutionQuery(query);
  if (!parsed) {
    yield {
      type: "error",
      data: {
        message: formatSwapParseFailureMessage(query, sessionContext),
        code: "SWAP_PARSE_FAILED",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const chainSlug = resolveSwapChainSlug(parsed, sessionContext);
  const chainInfo = chainSlug ? resolveChain(chainSlug) : undefined;
  if (!chainInfo?.chainId) {
    yield {
      type: "error",
      data: {
        message: `Unknown chain for swap. Pick a supported chain or say "on Base" / "on eth".`,
        code: "CHAIN_NOT_FOUND",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const client = createIntentMcpSwapClient(config);
  const chainId = chainInfo.chainId;
  const start = Date.now();
  const transportLabel = config.transport === "mcp-remote" ? config.mcpUrl : config.apiUrl;
  let tokenInResolved: TokenHit | undefined;
  let tokenOutResolved: TokenHit | undefined;

  try {
    const tokenInQuery = resolveSwapTokenSearchQuery(parsed.tokenInSymbol);
    yield {
      type: "tool",
      data: {
        tool: "intent-mcp.search_token",
        input: { chainId, query: tokenInQuery },
      },
    };
    const tokenInHit = await client.searchToken(chainId, tokenInQuery);
    if (!tokenInHit) {
      yield {
        type: "error",
        data: {
          message: `Token "${parsed.tokenInSymbol}" not found on ${chainInfo.name}. Try a different symbol.`,
          code: "TOKEN_NOT_FOUND",
        },
      };
      yield { type: "done", data: {} };
      return;
    }
    const tokenIn = normalizeSwapTokenHit(tokenInHit, parsed.tokenInSymbol);
    tokenInResolved = tokenIn;

    const outQuery = resolveSwapTokenSearchQuery(parsed.tokenOutSymbol);
    yield {
      type: "tool",
      data: {
        tool: "intent-mcp.search_token",
        input: { chainId, query: outQuery },
      },
    };
    const tokenOutHit = await client.searchToken(chainId, outQuery);
    if (!tokenOutHit) {
      yield {
        type: "error",
        data: {
          message: `Token "${parsed.tokenOutSymbol}" not found on ${chainInfo.name}.`,
          code: "TOKEN_NOT_FOUND",
        },
      };
      yield { type: "done", data: {} };
      return;
    }
    const tokenOut = normalizeSwapTokenHit(tokenOutHit, parsed.tokenOutSymbol);
    tokenOutResolved = tokenOut;

    const amount = humanToAtomic(parsed.amountHuman, tokenIn.decimals);
    const executionMode = resolveSwapExecutionMode(sessionContext);
    const quoteBody: Record<string, unknown> = {
      fromChain: chainId,
      toChain: chainId,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amount,
      slippageBps: 300,
      swapType: "EXACT_INPUT" as const,
      executionMode,
    };
    if (sessionContext.connectedAddress) {
      quoteBody.walletAddress = sessionContext.connectedAddress;
    }

    yield {
      type: "tool",
      data: { tool: "intent-mcp.get_swap_quote", input: quoteBody },
    };

    const quote = await client.getSwapQuote(quoteBody);
    const display = buildSwapQuoteDisplay(parsed, tokenIn, tokenOut, quote, chainInfo.name);
    const answer = formatQuoteAnswer(parsed, tokenIn, tokenOut, quote, chainInfo.name);

    yield {
      type: "result",
      data: {
        route: "intent-swap",
        intentMcpTransport: config.transport,
        answer,
        output: { quote, display },
        latencyMs: Date.now() - start,
      },
    };
    yield { type: "token", data: { text: answer } };
    yield { type: "done", data: {} };
  } catch (err) {
    yield {
      type: "error",
      data: {
        message: formatIntentMcpQuoteError(err, {
          chainName: chainInfo.name,
          amountHuman: parsed.amountHuman,
          tokenInSymbol: parsed.tokenInSymbol,
          tokenOutSymbol: parsed.tokenOutSymbol,
          tokenIn: tokenInResolved,
          tokenOut: tokenOutResolved,
          transportLabel,
          transport: config.transport,
        }),
        code: "INTENT_MCP_ERROR",
      },
    };
    yield { type: "done", data: {} };
  } finally {
    await client.close();
  }
}
