import { getAddress, recoverMessageAddress } from "viem";
import { ensureSessionToken, sessionHeaders } from "./session";
import { listPermittedAccounts, revokeSiteWalletPermissions, requestSingleAccountAccess } from "./wallet-connect";
import { getBoundConnectedAddress, resolveWalletProvider, walletConnectionHint } from "./wallet-provider";

async function swapFetch(apiUrl: string, path: string, body: unknown): Promise<Response> {
  await ensureSessionToken(apiUrl);
  return fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: sessionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export type SwapQuoteDisplay = {
  chainName: string;
  chainId?: number;
  amountIn: string;
  tokenIn: string;
  amountInAtomic: string;
  tokenInAddress: string;
  amountOut: string;
  tokenOut: string;
  tokenOutAddress?: string;
  route?: string;
  routeType?: string;
  gasless?: boolean;
  gasEstimateUsd?: number;
  executionMode?: "any" | "gasless" | "gas";
  quoteId: string;
  expiresAt: string;
};

export type SigningInstructions = {
  type?: string;
  method?: string;
  typedData?: unknown;
  eip712?: unknown;
  domain?: unknown;
  types?: unknown;
  message?: unknown;
  primaryType?: string;
  transaction?: Record<string, unknown>;
  tx?: Record<string, unknown>;
  personalMessage?: string;
  signingPayloads?: Array<{
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
    primaryType: string;
  }>;
  steps?: unknown;
  [key: string]: unknown;
};

export class SwapApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SwapApiError";
  }
}

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parseEthAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!ETH_ADDRESS_RE.test(trimmed)) return undefined;
  return getAddress(trimmed);
}

/** Account MetaMask will use for signing — eth_requestAccounts[0] (selected account is listed first). */
export async function resolveActiveSigningAddress(
  provider: NonNullable<Window["ethereum"]>,
): Promise<{ signing: string; permitted: string; selected?: string }> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as
    | string[]
    | undefined;
  const signing = parseEthAddress(accounts?.[0]);
  if (!signing) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }
  // selectedAddress is deprecated and often stale — do not prefer it over eth_requestAccounts[0]
  const legacySelected = parseEthAddress(provider.selectedAddress);
  const selected =
    legacySelected && legacySelected !== signing ? legacySelected : undefined;
  return { signing, permitted: signing, selected };
}

/** Reject when multiple MetaMask accounts are authorized — the EIP-712 popup account picker causes mismatches. */
export async function assertSinglePermittedAccount(expected: string): Promise<string> {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }

  const bound = getBoundConnectedAddress();
  const want = getAddress(bound ?? expected);
  if (bound && getAddress(expected) !== want) {
    throw new SwapApiError(
      `Connected wallet is ${want} but this step used ${getAddress(expected)}. Disconnect and Connect Wallet again.`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  const permitted = await listPermittedAccounts(provider);
  if (permitted.length !== 1 || permitted[0] !== want) {
    if (permitted.length > 1) {
      await revokeSiteWalletPermissions(provider);
    }
    throw new SwapApiError(
      permitted.length > 1
        ? `MetaMask has ${permitted.length} accounts authorized (${permitted.join(", ")}). Only ${want} may sign. Disconnect this site in MetaMask → Connected sites, then Connect Wallet with only ${want} selected.`
        : `MetaMask active account ${permitted[0] ?? "none"} does not match connected wallet ${want}. Click the account circle in MetaMask and select ${want} before approving.`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  return assertActiveWalletMatches(want);
}

const PERMIT2_ACCOUNT_CHECK_PREFIX = "MetaLift Permit2 account verification";

/** Prove MetaMask will personal_sign as the bound wallet before Permit2 typed data. */
export async function assertWalletPersonalSignMatches(walletAddress: string): Promise<void> {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }
  const want = getAddress(walletAddress);
  const message =
    `${PERMIT2_ACCOUNT_CHECK_PREFIX}\n` +
    `Wallet: ${want}\n` +
    "Sign only if this is your active MetaMask account for this swap.";

  let signature: string;
  try {
    signature = (await provider.request({
      method: "personal_sign",
      params: [message, want],
    })) as string;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new SwapApiError(
      `Wallet rejected the account verification prompt: ${errMessage}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  let recovered: string;
  try {
    recovered = getAddress(
      await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      }),
    );
  } catch {
    throw new SwapApiError(
      "Could not verify which account signed the account check. Request a fresh quote and try again.",
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  if (recovered !== want) {
    throw new SwapApiError(
      `MetaMask signed the account check as ${recovered}, not ${want}. ` +
        `Click the account circle in MetaMask, select ${want}, then request a fresh quote. ${walletConnectionHint()}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }
}

export { PERMIT2_ACCOUNT_CHECK_PREFIX };

/**
 * MetaMask's Permit2 popup can sign with any wallet account even when eth_requestAccounts
 * returns only the bound address. Revoke and re-authorize exactly one account immediately
 * before Permit2 EIP-712 signing (injected MetaMask only).
 */
export async function preparePermit2SigningAccount(expected: string): Promise<string> {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }
  const want = getAddress(getBoundConnectedAddress() ?? expected);
  const permitted = await listPermittedAccounts(provider);
  const needsReauth = permitted.length !== 1 || permitted[0] !== want;

  if (needsReauth) {
    await revokeSiteWalletPermissions(provider);
    const selected = await requestSingleAccountAccess(provider);
    if (getAddress(selected) !== want) {
      throw new SwapApiError(
        `You authorized ${getAddress(selected)} in MetaMask but this swap requires ${want}. ` +
          `In the MetaMask account list, select ${want} (your connected wallet). ${walletConnectionHint()}`,
        "WALLET_ACCOUNT_MISMATCH",
      );
    }
  }

  const locked = await assertSinglePermittedAccount(want);
  await assertWalletPersonalSignMatches(locked);
  return locked;
}

/** Re-prompt MetaMask for a single account immediately before signing. */
export async function lockSigningAccount(expected: string): Promise<string> {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }
  const want = getAddress(getBoundConnectedAddress() ?? expected);
  // Do not call wallet_requestPermissions here — re-prompting can authorize a second account
  // and MetaMask's Permit2 popup may sign with that account instead of the bound wallet.
  return assertSinglePermittedAccount(want);
}

/** Active MetaMask account — must match the connected address shown in the app. */
export async function assertActiveWalletMatches(expected?: string): Promise<string> {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }

  const { signing, permitted, selected } = await resolveActiveSigningAddress(provider);

  const expectedTrimmed = expected?.trim();
  const expectedAddr =
    expectedTrimmed && ETH_ADDRESS_RE.test(expectedTrimmed) ? getAddress(expectedTrimmed) : undefined;

  if (expectedAddr && signing !== expectedAddr) {
    const hint =
      selected
        ? `MetaMask active account is ${signing} (stale selectedAddress was ${selected}). Switch MetaMask to your connected wallet ${expectedAddr} before signing.`
        : `Switch MetaMask to your connected wallet ${expectedAddr}, then try again.`;
    throw new SwapApiError(
      `Wallet account mismatch: connected wallet is ${expectedAddr} but MetaMask will sign as ${signing}. ${hint} ${walletConnectionHint()}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  return expectedAddr ?? signing;
}

export function normalizeSwapWalletAddress(walletAddress: string): string {
  const trimmed = walletAddress.trim();
  if (!ETH_ADDRESS_RE.test(trimmed)) {
    throw new SwapApiError(
      "walletAddress is required — connect your wallet first",
      "WALLET_NOT_CONNECTED",
    );
  }
  return trimmed;
}

export function isWalletAccountMismatchError(err: unknown): boolean {
  if (err instanceof SwapApiError && err.code === "WALLET_ACCOUNT_MISMATCH") return true;
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Permit2 signature is from .* but submit used/i.test(message) ||
    /Permit2 must be signed by/i.test(message) ||
    /Permit2 signature does not verify/i.test(message)
  );
}

export async function resolveConnectedWalletAddress(connected?: string): Promise<string> {
  return assertActiveWalletMatches(connected);
}

export function isInsufficientAllowanceError(err: unknown): boolean {
  if (err instanceof SwapApiError && err.code === "INSUFFICIENT_ALLOWANCE") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Insufficient allowance|INSUFFICIENT_ALLOWANCE/i.test(message);
}

export async function fetchSwapInstructions(
  apiUrl: string,
  intentId: string,
): Promise<{ intentId: string; signingInstructions: SigningInstructions }> {
  const res = await swapFetch(apiUrl, "/swap/instructions", { intentId });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    signingInstructions?: SigningInstructions;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Instructions failed (${res.status})`, json.code, res.status);
  }
  if (!json.signingInstructions) {
    throw new Error("Invalid instructions response from server");
  }
  return { intentId: json.intentId ?? intentId, signingInstructions: json.signingInstructions };
}

export async function fetchQuoteConfirmation(
  apiUrl: string,
  quoteId: string,
  walletAddress: string,
): Promise<{
  quoteId: string;
  walletAddress: string;
  quoteCommitment: string;
  message: string;
  expiresAt: string;
}> {
  const res = await swapFetch(apiUrl, "/swap/quote-confirmation", {
    quoteId,
    walletAddress: normalizeSwapWalletAddress(walletAddress),
  });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    quoteId?: string;
    walletAddress?: string;
    quoteCommitment?: string;
    message?: string;
    expiresAt?: string;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Quote confirmation failed (${res.status})`, json.code, res.status);
  }
  if (!json.message?.trim()) {
    throw new Error("Invalid quote confirmation response from server");
  }
  return {
    quoteId: json.quoteId ?? quoteId,
    walletAddress: json.walletAddress ?? walletAddress,
    quoteCommitment: json.quoteCommitment ?? "",
    message: json.message,
    expiresAt: json.expiresAt ?? "",
  };
}

export async function prepareSwap(
  apiUrl: string,
  quoteId: string,
  walletAddress: string,
  expectedQuote?: {
    tokenInAddress: string;
    tokenOutAddress: string;
    amountInAtomic: string;
    chainId: number;
  },
  requote?: {
    fromChain: number;
    toChain?: number;
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippageBps?: number;
    executionMode?: "any" | "gasless";
  },
  confirmationSignature?: string,
  options?: {
    acknowledgeUserPaidGas?: boolean;
    quoteExecutionMode?: string;
    quoteRoute?: string;
    quoteRouteType?: string;
    quoteGasEstimateUsd?: number;
    quoteGasless?: boolean;
  },
): Promise<{
  intentId?: string;
  signingInstructions?: SigningInstructions;
  requoteApplied?: boolean;
  requoteNote?: string;
  freshQuoteId?: string;
  freshQuoteExpiresAt?: string;
  freshExecutionMode?: string;
  confirmationRequired?: boolean;
}> {
  const res = await swapFetch(apiUrl, "/swap/prepare", {
    quoteId,
    walletAddress,
    expectedQuote,
    requote,
    confirmationSignature,
    acknowledgeUserPaidGas: options?.acknowledgeUserPaidGas,
    quoteExecutionMode: options?.quoteExecutionMode,
    quoteRoute: options?.quoteRoute,
    quoteRouteType: options?.quoteRouteType,
    quoteGasEstimateUsd: options?.quoteGasEstimateUsd,
    quoteGasless: options?.quoteGasless,
  });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    signingInstructions?: SigningInstructions;
    requoteApplied?: boolean;
    requoteNote?: string;
    freshQuoteId?: string;
    freshQuoteExpiresAt?: string;
    freshExecutionMode?: string;
    confirmationRequired?: boolean;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Prepare failed (${res.status})`, json.code, res.status);
  }
  if (json.requoteApplied && json.confirmationRequired) {
    return {
      requoteApplied: true,
      requoteNote: json.requoteNote,
      freshQuoteId: json.freshQuoteId,
      freshQuoteExpiresAt: json.freshQuoteExpiresAt,
      freshExecutionMode: json.freshExecutionMode,
      confirmationRequired: true,
    };
  }
  if (!json.intentId || !json.signingInstructions) {
    throw new Error("Invalid prepare response from server");
  }
  return {
    intentId: json.intentId,
    signingInstructions: json.signingInstructions,
    requoteApplied: json.requoteApplied,
    requoteNote: json.requoteNote,
    freshQuoteId: json.freshQuoteId,
    freshQuoteExpiresAt: json.freshQuoteExpiresAt,
    freshExecutionMode: json.freshExecutionMode,
  };
}

export async function syncPermitSwap(
  apiUrl: string,
  intentId: string,
  signature: string,
  walletAddress?: string,
): Promise<{
  intentId: string;
  status?: string;
  txHash?: string;
  permitSigner?: string;
  walletAddressCorrected?: boolean;
  pendingMoreSignatures?: boolean;
}> {
  const res = await swapFetch(apiUrl, "/swap/sync-permit", {
    intentId,
    signature,
    walletAddress,
  });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    status?: string;
    txHash?: string;
    permitSigner?: string;
    walletAddressCorrected?: boolean;
    pendingMoreSignatures?: boolean;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Sync permit failed (${res.status})`, json.code, res.status);
  }
  return {
    intentId: json.intentId ?? intentId,
    status: json.status,
    txHash: json.txHash,
    permitSigner: json.permitSigner,
    walletAddressCorrected: json.walletAddressCorrected,
    pendingMoreSignatures: json.pendingMoreSignatures,
  };
}

export async function submitSwap(
  apiUrl: string,
  intentId: string,
  signature: string,
  walletAddress: string,
  metadata?: {
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    chainName?: string;
  },
  txHash?: string,
): Promise<{
  intentId: string;
  status?: string;
  txHash?: string;
  pendingMoreSignatures?: boolean;
  signingInstructions?: SigningInstructions;
}> {
  const res = await swapFetch(apiUrl, "/swap/submit", {
    intentId,
    signature,
    walletAddress: normalizeSwapWalletAddress(walletAddress),
    txHash: txHash?.trim() || undefined,
    ...metadata,
  });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    status?: string;
    txHash?: string;
    pendingMoreSignatures?: boolean;
    signingInstructions?: SigningInstructions;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Submit failed (${res.status})`, json.code, res.status);
  }
  return {
    intentId: json.intentId ?? intentId,
    status: json.status,
    txHash: json.txHash,
    pendingMoreSignatures: json.pendingMoreSignatures,
    signingInstructions: json.signingInstructions,
  };
}

export async function pollSwapStatus(
  apiUrl: string,
  intentId: string,
): Promise<{ intentId: string; status?: string; txHash?: string; error?: string }> {
  const res = await swapFetch(apiUrl, "/swap/status", { intentId, poll: true });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    status?: string;
    txHash?: string;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Status poll failed (${res.status})`, json.code, res.status);
  }
  return {
    intentId: json.intentId ?? intentId,
    status: json.status,
    txHash: json.txHash,
    error: json.error,
  };
}

const COMPLETED_STATUSES = new Set(["completed", "success", "successful", "filled", "executed"]);
const FAILED_STATUSES = new Set(["failed", "error", "reverted", "cancelled", "canceled", "expired"]);

export function isSwapCompleted(status?: string): boolean {
  return Boolean(status && COMPLETED_STATUSES.has(status.toLowerCase()));
}

export function isSwapFailed(status?: string): boolean {
  return Boolean(status && FAILED_STATUSES.has(status.toLowerCase()));
}
