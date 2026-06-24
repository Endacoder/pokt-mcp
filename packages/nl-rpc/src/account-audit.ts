import { listChains, resolveChain, MAX_BLOCK_RANGE } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import { resolveAddress, wantsMyWallet } from "./patterns.js";
import { KNOWN_TOKENS } from "./tokens.js";
import {
  executeWalletBalances,
  executeWalletBalancesMulti,
  type WalletBalancesResult,
} from "./wallet-balance.js";
import {
  convertWalletPortfolio,
  snapshotFromMultiWalletBalances,
  type PortfolioConvertResult,
} from "./portfolio-convert.js";
import type { TxHistoryEntry } from "./tx-history.js";
import { fetchRecentTxsViaBlockScan } from "./tx-history.js";

/** keccak256("Approval(address,address,uint256)") */
export const ERC20_APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d36bd18fad108ccfe36cb6985c0ef8377ccc628b1ad40bc2fd3";

const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const MAX_UINT256 = (1n << 256n) - 1n;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B42943C0689843B7";

const KNOWN_SPENDERS: Record<string, string[]> = {
  eth: [
    PERMIT2,
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F24A8",
  ],
  base: [
    PERMIT2,
    "0x2626664c2603336E57B271c5C0b26F421741e481",
    "0x4752ba5DBc23f44D878b265aa4D6C816965FBd52",
  ],
  "arb-one": [
    PERMIT2,
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "0x4752ba5DBc23f44D878b265aa4D6C816965FBd52",
  ],
  poly: [
    PERMIT2,
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
  ],
  opt: [
    PERMIT2,
    "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "0x4752ba5DBc23f44D878b265aa4D6C816965FBd52",
  ],
  avax: [PERMIT2, "0xE592427A0AEce92De3Edee1F18E0157C05861564"],
  bsc: [PERMIT2, "0x10ED43C718714eb63d5aA57B78B54704E256024E"],
};

export type ApprovalRiskLevel = "none" | "limited" | "high" | "unlimited";

export type TokenApproval = {
  tokenAddress: string;
  tokenSymbol: string;
  spender: string;
  allowanceRaw: string;
  allowanceFormatted: string;
  riskLevel: ApprovalRiskLevel;
};

export type ChainAuditDataSources = {
  balances: "pocket_rpc";
  accountMeta: "pocket_rpc";
  approvals: "pocket_rpc";
  activity: "pocket_rpc" | "skipped";
  tokenPortfolio: "pocket_rpc" | "skipped";
};

export type AccountAuditOptions = {
  activityTxLimit?: number;
  /** Blocks to scan for recent native txs via eth_getBlockByNumber (Pocket RPC). */
  activityBlockScanDepth?: number;
  approvalLogBlockRange?: number;
  maxApprovalsPerChain?: number;
  /** Scan all KNOWN_TOKENS on chain via eth_call (Pocket RPC). */
  scanKnownTokens?: boolean;
  /** Cap how many active chains get a full per-chain audit (wallet health). */
  maxActiveChains?: number;
};

/** Interactive chat/MCP default — full 50k-block scans across every active chain can take minutes. */
export const CHAT_ACCOUNT_AUDIT_OPTIONS: AccountAuditOptions = {
  activityTxLimit: 0,
  activityBlockScanDepth: 0,
  approvalLogBlockRange: 10_000,
  maxApprovalsPerChain: 10,
  maxActiveChains: 5,
};

export type ChainAuditResult = {
  chain: string;
  chainName: string;
  accountType: "eoa" | "contract";
  nonce: number;
  balances: WalletBalancesResult;
  recentTransactions?: TxHistoryEntry[];
  approvals: TokenApproval[];
  dataSources: ChainAuditDataSources;
  activityNote?: string;
  errors?: string[];
};

export type AuditFinding = {
  severity: "low" | "medium" | "high";
  chain: string;
  category: "unlimited_approval" | "high_approval" | "contract_account" | "activity";
  message: string;
  tokenAddress?: string;
  spender?: string;
};

export type AccountAuditResult = {
  address: string;
  scannedChains: number;
  activeChains: number;
  /** Core audit reads balances, approvals, and account state via Pocket Network RPC. */
  primaryDataSource: "pocket_network_rpc";
  portfolio?: PortfolioConvertResult;
  chains: ChainAuditResult[];
  findings: AuditFinding[];
  riskLevel: "low" | "medium" | "high";
  summary: string;
  limitations: string[];
};

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isAccountAuditQuery(query: string): boolean {
  const q = normalize(query);
  if (/\baudit\s+log\b/.test(q)) return false;
  return (
    /\baudit\b.*\b(account|address|wallet)\b/.test(q) ||
    /\b(account|wallet)\b.*\baudit\b/.test(q) ||
    /\bsecurity\s+(check|audit|review)\b/.test(q) ||
    /\bcheck\b.*\b(token\s+)?approvals?\b/.test(q) ||
    /\btoken\s+approvals?\b/.test(q) ||
    /\bunlimited\s+approvals?\b/.test(q)
  );
}

export function matchAccountAuditQuery(
  query: string,
  context?: SessionContext,
): RpcIntent | null {
  if (!isAccountAuditQuery(query)) return null;

  const address = resolveAddress(query, context);
  if (!address) {
    if (wantsMyWallet(query) || /\bmy\s+account\b/.test(normalize(query))) {
      throw new Error(
        "WALLET_NOT_CONNECTED: Connect your wallet to audit your account, or provide an explicit address.",
      );
    }
    return null;
  }

  return {
    action: "read",
    chain: "eth",
    method: "__account_audit__",
    params: [address, CHAT_ACCOUNT_AUDIT_OPTIONS],
    humanSummary: `Security audit for ${address} across Pocket EVM mainnets`,
    riskLevel: "none",
  };
}

function padAddress(address: string): string {
  return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function encodeAllowanceCalldata(owner: string, spender: string): string {
  return `${ALLOWANCE_SELECTOR}${padAddress(owner)}${padAddress(spender)}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function parseBalanceToRaw(balance: string, decimals: number): bigint {
  const [wholeRaw, fracRaw = ""] = balance.split(".");
  const whole = wholeRaw.replace(/[^\d]/g, "") || "0";
  const frac = fracRaw.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function classifyApproval(allowance: bigint, balanceRaw: bigint): ApprovalRiskLevel {
  if (allowance === 0n) return "none";
  if (allowance === MAX_UINT256) return "unlimited";
  if (balanceRaw > 0n && allowance >= balanceRaw) return "high";
  return "limited";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

type HeldToken = {
  address: string;
  symbol: string;
  decimals: number;
  balanceRaw: bigint;
};

function encodeBalanceOfCalldata(address: string): string {
  return `0x70a08231${padAddress(address)}`;
}

async function fetchKnownTokenBalancesPocket(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
): Promise<HeldToken[]> {
  const known = KNOWN_TOKENS[chain] ?? {};
  const held: HeldToken[] = [];
  for (const [symbol, info] of Object.entries(known)) {
    try {
      const resp = await pocket.rpc(chain, "eth_call", [
        { to: info.address, data: encodeBalanceOfCalldata(address) },
        "latest",
      ]);
      const raw = BigInt(resp.result as string);
      if (raw === 0n) continue;
      held.push({
        address: info.address,
        symbol,
        decimals: info.decimals,
        balanceRaw: raw,
      });
    } catch {
      // skip token
    }
  }
  return held;
}

function heldTokensFromBalances(balances: WalletBalancesResult): HeldToken[] {
  const tokenMap = new Map<string, HeldToken>();

  for (const t of balances.tokens) {
    if (parseFloat(t.balance) <= 0) continue;
    const addr = KNOWN_TOKENS[balances.chain]?.[t.symbol]?.address;
    if (!addr) continue;
    tokenMap.set(addr.toLowerCase(), {
      address: addr,
      symbol: t.symbol,
      decimals: t.decimals,
      balanceRaw: parseBalanceToRaw(t.balance, t.decimals),
    });
  }

  return [...tokenMap.values()];
}

function mergeHeldTokens(balances: WalletBalancesResult, extra: HeldToken[]): HeldToken[] {
  const tokenMap = new Map<string, HeldToken>();
  for (const t of heldTokensFromBalances(balances)) {
    tokenMap.set(t.address.toLowerCase(), t);
  }
  for (const t of extra) {
    if (!tokenMap.has(t.address.toLowerCase())) {
      tokenMap.set(t.address.toLowerCase(), t);
    }
  }
  return [...tokenMap.values()];
}

function getKnownSpenders(chain: string): string[] {
  const spenders = KNOWN_SPENDERS[chain] ?? [PERMIT2];
  return [...new Set(spenders.map((s) => s.toLowerCase()))];
}

async function fetchApprovalLogs(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
  blockRange: number,
): Promise<Array<{ token: string; spender: string }>> {
  const headResp = await pocket.rpc<string>(chain, "eth_blockNumber", []);
  const head = BigInt(headResp.result);
  const earliest = head > BigInt(blockRange) ? head - BigInt(blockRange) : 0n;
  const pairs = new Map<string, { token: string; spender: string }>();

  let windowEnd = head;
  while (windowEnd > earliest) {
    const windowStart =
      windowEnd >= BigInt(MAX_BLOCK_RANGE)
        ? windowEnd - BigInt(MAX_BLOCK_RANGE)
        : 0n;
    const from = windowStart > earliest ? windowStart : earliest;

    const filter = {
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${windowEnd.toString(16)}`,
      topics: [ERC20_APPROVAL_TOPIC, `0x${padAddress(address)}`, null],
    };

    const resp = await pocket.rpc(chain, "eth_getLogs", [filter]);
    const logs = (resp.result as Array<{ address?: string; topics?: string[] }>) ?? [];

    for (const log of logs) {
      const token = log.address;
      const spenderTopic = log.topics?.[2];
      if (!token || !spenderTopic || spenderTopic.length < 42) continue;
      const spender = `0x${spenderTopic.slice(-40)}`;
      const key = `${token.toLowerCase()}:${spender.toLowerCase()}`;
      pairs.set(key, { token, spender });
    }

    if (from <= earliest) break;
    windowEnd = from > 0n ? from - 1n : 0n;
  }

  return [...pairs.values()];
}

async function readAllowance(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const data = encodeAllowanceCalldata(owner, spender);
  const resp = await pocket.rpc(chain, "eth_call", [{ to: token, data }, "latest"]);
  const hex = resp.result as string;
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

async function auditChain(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  chain: string,
  address: string,
  opts: AccountAuditOptions,
): Promise<ChainAuditResult> {
  const chainInfo = resolveChain(chain);
  const errors: string[] = [];
  const activityTxLimit = opts.activityTxLimit ?? 5;
  const activityBlockScanDepth = opts.activityBlockScanDepth ?? 150;
  const approvalLogBlockRange = opts.approvalLogBlockRange ?? 50000;
  const maxApprovals = opts.maxApprovalsPerChain ?? 25;
  const scanKnownTokens = opts.scanKnownTokens ?? true;

  let balances: WalletBalancesResult;
  try {
    balances = await executeWalletBalances(pocket, chain, address);
  } catch (err) {
    throw err;
  }

  let accountType: "eoa" | "contract" = "eoa";
  let nonce = 0;
  try {
    const codeResp = await pocket.rpc(chain, "eth_getCode", [address, "latest"]);
    const code = (codeResp.result as string) ?? "0x";
    accountType = code === "0x" || code === "0x0" ? "eoa" : "contract";
    const nonceResp = await pocket.rpc(chain, "eth_getTransactionCount", [address, "latest"]);
    nonce = parseInt(nonceResp.result as string, 16);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  let recentTransactions: TxHistoryEntry[] | undefined;
  let activitySource: ChainAuditDataSources["activity"] = "skipped";
  let activityNote: string | undefined;
  try {
    recentTransactions = await fetchRecentTxsViaBlockScan(
      pocket,
      chain,
      address,
      activityTxLimit,
      activityBlockScanDepth,
    );
    activitySource = "pocket_rpc";
    activityNote = `Recent native txs via Pocket RPC block scan (last ~${activityBlockScanDepth} blocks).`;
  } catch (err) {
    errors.push(`activity: ${err instanceof Error ? err.message : String(err)}`);
  }

  let extraKnownTokens: HeldToken[] = [];
  let tokenPortfolioSource: ChainAuditDataSources["tokenPortfolio"] = "skipped";
  if (scanKnownTokens) {
    try {
      extraKnownTokens = await fetchKnownTokenBalancesPocket(pocket, chain, address);
      tokenPortfolioSource = "pocket_rpc";
    } catch (err) {
      errors.push(`known tokens: ${err instanceof Error ? err.message : String(err)}`);
      tokenPortfolioSource = "pocket_rpc";
    }
  }

  const heldTokens = mergeHeldTokens(balances, extraKnownTokens);
  const approvalPairs = new Map<string, { token: string; spender: string; symbol: string; decimals: number; balanceRaw: bigint }>();

  for (const token of heldTokens) {
    for (const spender of getKnownSpenders(chain)) {
      const key = `${token.address.toLowerCase()}:${spender}`;
      approvalPairs.set(key, {
        token: token.address,
        spender,
        symbol: token.symbol,
        decimals: token.decimals,
        balanceRaw: token.balanceRaw,
      });
    }
  }

  try {
    const logPairs = await fetchApprovalLogs(pocket, chain, address, approvalLogBlockRange);
    for (const pair of logPairs) {
      const key = `${pair.token.toLowerCase()}:${pair.spender.toLowerCase()}`;
      if (!approvalPairs.has(key)) {
        const held = heldTokens.find((t) => t.address.toLowerCase() === pair.token.toLowerCase());
        approvalPairs.set(key, {
          token: pair.token,
          spender: pair.spender,
          symbol: held?.symbol ?? "TOKEN",
          decimals: held?.decimals ?? 18,
          balanceRaw: held?.balanceRaw ?? 0n,
        });
      }
    }
  } catch (err) {
    errors.push(`approval logs: ${err instanceof Error ? err.message : String(err)}`);
  }

  const approvals: TokenApproval[] = [];
  const pairsToCheck = [...approvalPairs.values()].slice(0, maxApprovals);

  for (const pair of pairsToCheck) {
    try {
      const allowance = await readAllowance(pocket, chain, pair.token, address, pair.spender);
      const riskLevel = classifyApproval(allowance, pair.balanceRaw);
      if (riskLevel === "none") continue;
      approvals.push({
        tokenAddress: pair.token,
        tokenSymbol: pair.symbol,
        spender: pair.spender,
        allowanceRaw: allowance.toString(),
        allowanceFormatted: formatTokenAmount(allowance, pair.decimals),
        riskLevel,
      });
    } catch {
      // skip failed allowance reads
    }
  }

  return {
    chain,
    chainName: chainInfo?.name ?? chain,
    accountType,
    nonce,
    balances,
    recentTransactions,
    approvals,
    dataSources: {
      balances: "pocket_rpc",
      accountMeta: "pocket_rpc",
      approvals: "pocket_rpc",
      activity: activitySource,
      tokenPortfolio: tokenPortfolioSource,
    },
    activityNote,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function collectFindings(chains: ChainAuditResult[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const ch of chains) {
    if (ch.accountType === "contract") {
      findings.push({
        severity: "low",
        chain: ch.chain,
        category: "contract_account",
        message: `Address is a contract on ${ch.chainName} (not an EOA).`,
      });
    }

    for (const approval of ch.approvals) {
      if (approval.riskLevel === "unlimited") {
        findings.push({
          severity: "high",
          chain: ch.chain,
          category: "unlimited_approval",
          message: `Unlimited ${approval.tokenSymbol} approval to ${approval.spender.slice(0, 10)}…`,
          tokenAddress: approval.tokenAddress,
          spender: approval.spender,
        });
      } else if (approval.riskLevel === "high") {
        findings.push({
          severity: "medium",
          chain: ch.chain,
          category: "high_approval",
          message: `High ${approval.tokenSymbol} allowance (${approval.allowanceFormatted}) to ${approval.spender.slice(0, 10)}…`,
          tokenAddress: approval.tokenAddress,
          spender: approval.spender,
        });
      }
    }
  }

  return findings;
}

function overallRiskLevel(findings: AuditFinding[]): AccountAuditResult["riskLevel"] {
  if (findings.some((f) => f.severity === "high")) return "high";
  if (findings.some((f) => f.severity === "medium")) return "medium";
  return "low";
}

function buildSummary(result: Omit<AccountAuditResult, "summary">): string {
  const short = `${result.address.slice(0, 6)}…${result.address.slice(-4)}`;
  const lines = [
    `Account audit for ${short}: ${result.activeChains} active chain(s) of ${result.scannedChains} scanned.`,
    `Data source: Pocket Network RPC (balances, approvals, account state).`,
    `Overall risk: ${result.riskLevel}.`,
  ];

  if (result.portfolio) {
    lines.push(`Estimated portfolio: ~$${result.portfolio.totalUsd.toFixed(2)} USD across ${result.portfolio.chainCount} chain(s).`);
  }

  const unlimited = result.findings.filter((f) => f.category === "unlimited_approval");
  if (unlimited.length > 0) {
    lines.push(`${unlimited.length} unlimited token approval(s) detected — review and revoke if unused.`);
  } else if (result.findings.some((f) => f.category === "high_approval")) {
    lines.push("Some high token allowances found — verify spenders are trusted.");
  } else {
    lines.push("No unlimited approvals detected in scanned scope.");
  }

  if (result.limitations.length > 0) {
    lines.push(`Limitations: ${result.limitations[0]}`);
  }

  return lines.join(" ");
}

export async function executeAccountAudit(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  address: string,
  options?: AccountAuditOptions,
): Promise<AccountAuditResult> {
  const opts = options ?? {};
  const limitations: string[] = [
    "All audit reads use Pocket Network RPC only.",
    "Native tx activity uses Pocket block scan (configurable depth); not full chain history.",
    "Token holdings use KNOWN_TOKENS registry via eth_call; other ERC-20s may appear via Approval log discovery.",
    "Approval scan uses Pocket eth_getLogs + eth_call over a configurable block range plus known spenders — not a complete approval history.",
  ];

  const evmMainnets = listChains().filter((c) => c.protocol === "evm" && !c.testnet);
  const scannedChains = evmMainnets.length;

  const multi = await executeWalletBalancesMulti(pocket, address);
  const balanceChains = new Set(multi.chains.map((c) => c.chain));

  const nonceResults = await mapWithConcurrency(evmMainnets, 5, async (chainInfo) => {
    try {
      const resp = await pocket.rpc(chainInfo.slug, "eth_getTransactionCount", [address, "latest"]);
      const nonce = parseInt(resp.result as string, 16);
      return { slug: chainInfo.slug, nonce, hasBalance: balanceChains.has(chainInfo.slug) };
    } catch {
      return { slug: chainInfo.slug, nonce: 0, hasBalance: balanceChains.has(chainInfo.slug) };
    }
  });

  const activeSlugs = new Set<string>();
  for (const r of nonceResults) {
    if (r.hasBalance || r.nonce > 0) activeSlugs.add(r.slug);
  }

  let activeSlugList = [...activeSlugs];
  const maxActive = opts.maxActiveChains;
  if (maxActive && maxActive > 0 && activeSlugList.length > maxActive) {
    const rank = new Map(
      multi.chains.map((c) => [c.chain, parseFloat(c.nativeBalance) || 0]),
    );
    activeSlugList.sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
    activeSlugList = activeSlugList.slice(0, maxActive);
    limitations.push(`Per-chain audit limited to top ${maxActive} active chain(s) by native balance.`);
  }

  const chainAudits = await mapWithConcurrency(activeSlugList, 4, async (slug) => {
    try {
      return await auditChain(pocket, slug, address, opts);
    } catch (err) {
      const chainInfo = resolveChain(slug);
      return {
        chain: slug,
        chainName: chainInfo?.name ?? slug,
        accountType: "eoa" as const,
        nonce: 0,
        balances: {
          chain: slug,
          chainName: chainInfo?.name ?? slug,
          address,
          nativeSymbol: chainInfo?.nativeSymbol ?? "ETH",
          nativeBalance: "0",
          tokens: [],
        },
        approvals: [],
        dataSources: {
          balances: "pocket_rpc" as const,
          accountMeta: "pocket_rpc" as const,
          approvals: "pocket_rpc" as const,
          activity: "skipped" as const,
          tokenPortfolio: "skipped" as const,
        },
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  });

  let portfolio: PortfolioConvertResult | undefined;
  if (multi.chains.length > 0) {
    try {
      portfolio = await convertWalletPortfolio(snapshotFromMultiWalletBalances(multi), "usd", "USD");
    } catch {
      limitations.push("USD portfolio valuation failed (CoinGecko price lookup).");
    }
  }

  const findings = collectFindings(chainAudits);
  const riskLevel = overallRiskLevel(findings);

  const partial: Omit<AccountAuditResult, "summary"> = {
    address,
    scannedChains,
    activeChains: chainAudits.length,
    primaryDataSource: "pocket_network_rpc",
    portfolio,
    chains: chainAudits,
    findings,
    riskLevel,
    limitations,
  };

  return {
    ...partial,
    summary: buildSummary(partial),
  };
}

export function formatAccountAudit(result: AccountAuditResult): string {
  const lines = [result.summary, ""];

  for (const ch of result.chains) {
    lines.push(`${ch.chainName} (${ch.chain}): ${ch.accountType}, nonce ${ch.nonce}`);
    lines.push(`  Native: ${ch.balances.nativeBalance} ${ch.balances.nativeSymbol}`);
    for (const t of ch.balances.tokens) {
      if (parseFloat(t.balance) > 0) lines.push(`  ${t.symbol}: ${t.balance}`);
    }
    if (ch.approvals.length > 0) {
      lines.push(`  Active approvals (${ch.approvals.length}):`);
      for (const a of ch.approvals.slice(0, 5)) {
        lines.push(`    · ${a.tokenSymbol} → ${a.spender.slice(0, 10)}… (${a.riskLevel})`);
      }
      if (ch.approvals.length > 5) lines.push(`    …and ${ch.approvals.length - 5} more`);
    }
    if (ch.recentTransactions?.length) {
      lines.push(`  Recent txs: ${ch.recentTransactions.length}`);
    }
  }

  if (result.findings.length > 0) {
    lines.push("", "Findings:");
    for (const f of result.findings.slice(0, 10)) {
      lines.push(`  [${f.severity}] ${f.chain}: ${f.message}`);
    }
  }

  if (result.limitations.length > 0) {
    lines.push("", "Limitations:");
    for (const lim of result.limitations) {
      lines.push(`  · ${lim}`);
    }
  }

  return `\n${lines.join("\n")}`;
}
