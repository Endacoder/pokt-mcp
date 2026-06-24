import type { SigningInstructions } from "./swap-api";
import { assertSinglePermittedAccount, assertActiveWalletMatches, lockSigningAccount, preparePermit2SigningAccount, SwapApiError } from "./swap-api";
import {
  validateSwapQuoteAgainstInstructions,
  type ExpectedSwapQuote,
} from "./swap-quote-validation";
import {
  validateSwapApprovalTransaction,
  isQuotedPermit2ApproveTx,
  isErc20ApproveTransaction,
} from "./swap-tx-validation";
import {
  isNativeEthTokenAddress,
  isPermit2TypedDataPayload,
  isWalletRpcHttpError,
  prepareApproveTransactionIfNeeded,
  assertPermit2Erc20Allowance,
  walletRpcErrorMessage,
  type Permit2ApprovalContext,
} from "./permit2-approval";
import { chainRpcCall } from "./chain-rpc";
import { ensureWalletNetworkForSwap } from "./wallet-network";
import { sendWalletTransaction, normalizeGasQuantity } from "./wallet-tx";
import { sendWalletTransactions } from "./wallet-batch";
import {
  prepareTypedDataForWallet,
  validateTypedDataForWallet,
  type WalletTypedDataPayload,
} from "./typed-data-wallet";
import { recoverMetaMaskTypedDataSigner, verifyMetaMaskTypedDataSigner } from "./metamask-typed-data";
import { getAddress, isAddress, recoverTypedDataAddress, verifyTypedData } from "viem";
import { resolveWalletProviderOrThrow, walletConnectionHint, getBoundConnectedAddress } from "./wallet-provider";

const PERMIT2_ECDSA_SIG_RE = /^0x[a-fA-F0-9]{130}$/;

function normalizePermitSignature(signature: string): string {
  const trimmed = signature.trim();
  if (!PERMIT2_ECDSA_SIG_RE.test(trimmed)) return trimmed;
  const body = trimmed.slice(2);
  const r = body.slice(0, 64);
  const s = body.slice(64, 128);
  let v = parseInt(body.slice(128, 130), 16);
  if (v < 27) v += 27;
  return `0x${r}${s}${v.toString(16).padStart(2, "0")}`.toLowerCase();
}

type ExpectedPermit = Permit2ApprovalContext;

export type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
};

function buildTypedDataPayload(instructions: SigningInstructions): TypedDataPayload {
  if (instructions.typedData && typeof instructions.typedData === "object") {
    const raw = instructions.typedData as TypedDataPayload;
    return {
      domain: raw.domain as Record<string, unknown>,
      types: raw.types as Record<string, unknown>,
      message: raw.message as Record<string, unknown>,
      primaryType: String(raw.primaryType ?? "Order"),
    };
  }
  if (instructions.eip712 && typeof instructions.eip712 === "object") {
    const raw = instructions.eip712 as TypedDataPayload;
    return {
      domain: raw.domain as Record<string, unknown>,
      types: raw.types as Record<string, unknown>,
      message: raw.message as Record<string, unknown>,
      primaryType: String(raw.primaryType ?? "Order"),
    };
  }
  if (instructions.domain && instructions.types && instructions.message) {
    return {
      domain: instructions.domain as Record<string, unknown>,
      types: instructions.types as Record<string, unknown>,
      message: instructions.message as Record<string, unknown>,
      primaryType: String(instructions.primaryType ?? "Order"),
    };
  }
  throw new Error("No EIP-712 typed data in signing instructions");
}

function normalizeTx(tx: Record<string, unknown>, from: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tx, from: tx.from ?? from };
  if (out.chainId != null && typeof out.chainId === "number") {
    out.chainId = `0x${out.chainId.toString(16)}`;
  }
  const gasRaw = out.gas ?? out.gasLimit;
  if (gasRaw != null) {
    const gasHex =
      typeof gasRaw === "string" || typeof gasRaw === "number" || typeof gasRaw === "bigint"
        ? normalizeGasQuantity(gasRaw as string | number | bigint)
        : undefined;
    if (gasHex) {
      out.gas = gasHex;
      delete out.gasLimit;
    }
  }
  return out;
}

function extractTxRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const tx = obj.transaction ?? obj.tx;
  if (tx && typeof tx === "object") return tx as Record<string, unknown>;
  if (obj.type === "transaction" && obj.payload && typeof obj.payload === "object") {
    return obj.payload as Record<string, unknown>;
  }
  return undefined;
}

function instructionTxSources(instructions: SigningInstructions): unknown[] {
  const sources: unknown[] = [instructions, instructions.nextUnsignedIntent];
  const inner = instructions.instructions;
  if (inner && typeof inner === "object") {
    sources.push(inner);
  }
  if (Array.isArray(instructions.steps)) {
    sources.push(...instructions.steps);
  }
  return sources;
}

function dedupeTransactions(txs: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const tx of txs) {
    const key = JSON.stringify({ to: tx.to, data: tx.data, value: tx.value });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
  }
  return out;
}

/** Collect ERC20 approve(Permit2) txs only — not swap execution (e.g. Uniswap Universal Router). */
function collectApproveTransactions(
  instructions: SigningInstructions,
  quotedTokenAddress?: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  for (const source of instructionTxSources(instructions)) {
    const tx = extractTxRecord(source);
    if (!tx) continue;
    if (quotedTokenAddress && !isQuotedPermit2ApproveTx(tx, quotedTokenAddress)) continue;
    out.push(tx);
  }

  return dedupeTransactions(out);
}

/** Collect on-chain swap execution txs (router calls, etc.), excluding Permit2 approvals. */
function collectSwapExecutionTransactions(
  instructions: SigningInstructions,
  quotedTokenAddress?: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  for (const source of instructionTxSources(instructions)) {
    const tx = extractTxRecord(source);
    if (!tx) continue;
    if (quotedTokenAddress && isQuotedPermit2ApproveTx(tx, quotedTokenAddress)) continue;
    if (quotedTokenAddress && isErc20ApproveTransaction(tx)) continue;
    out.push(tx);
  }

  return dedupeTransactions(out);
}


async function waitForTransactionConfirmation(
  txHash: string,
  maxWaitMs = 120_000,
  apiUrl?: string,
  chainId?: number,
): Promise<void> {
  if (!apiUrl || chainId == null) {
    throw new Error("Cannot confirm transaction without Pocket RPC access.");
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const receipt = (await chainRpcCall(apiUrl, chainId, "eth_getTransactionReceipt", [txHash])) as {
        status?: string;
      } | null;
      if (receipt && typeof receipt === "object") {
        if (receipt.status === "0x0") {
          throw new Error(
            "Token approval transaction failed on-chain. Request a new quote and try again.",
          );
        }
        return;
      }
    } catch (err) {
      if (err instanceof Error && /failed on-chain/i.test(err.message)) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    "Token approval is still pending. Wait for confirmation in your wallet, then try again.",
  );
}

async function sendSwapOnChainTransactions(
  provider: NonNullable<Window["ethereum"]>,
  walletAddress: string,
  instructions: SigningInstructions,
  apiUrl?: string,
  chainId?: number,
  allowedTokenAddress?: string,
  skipInstructionApproves = false,
  proactiveApproveTx?: Record<string, unknown>,
  swapAmountAtomic?: string,
  /** When true, only ERC20→Permit2 approvals — not router swap execution (comes after Permit2 sign). */
  approvalsOnly = false,
): Promise<string> {
  if (!apiUrl || chainId == null) {
    throw new Error("Cannot confirm transaction without Pocket RPC access.");
  }

  let approveTxs = collectApproveTransactions(instructions, allowedTokenAddress);
  if (skipInstructionApproves && allowedTokenAddress) {
    approveTxs = approveTxs.filter((tx) => !isQuotedPermit2ApproveTx(tx, allowedTokenAddress));
  }
  if (proactiveApproveTx) {
    approveTxs = dedupeTransactions([proactiveApproveTx, ...approveTxs]);
  }

  const swapTxs = collectSwapExecutionTransactions(instructions, allowedTokenAddress);
  const txRecords = approvalsOnly ? approveTxs : [...approveTxs, ...swapTxs];
  const allTxs = txRecords.map((tx) => normalizeTx(tx, walletAddress));

  if (allTxs.length === 0) return "";

  if (chainId != null) {
    await ensureWalletNetworkForSwap(provider, chainId);
  }

  for (const tx of approveTxs) {
    if (allowedTokenAddress && isErc20ApproveTransaction(tx)) {
      validateSwapApprovalTransaction(tx, allowedTokenAddress);
    }
  }

  if (
    apiUrl &&
    chainId != null &&
    allowedTokenAddress &&
    swapAmountAtomic &&
    swapTxs.length > 0 &&
    !isNativeEthTokenAddress(allowedTokenAddress)
  ) {
    await assertPermit2Erc20Allowance(
      apiUrl,
      chainId,
      walletAddress,
      {
        tokenAddress: allowedTokenAddress,
        amountAtomic: swapAmountAtomic,
        chainId,
      },
      approveTxs.length > 0,
    );
  }

  return sendWalletTransactions(provider, walletAddress, allTxs, {
    apiUrl,
    chainId,
    waitForConfirmation: (txHash) => waitForTransactionConfirmation(txHash, 120_000, apiUrl, chainId),
  });
}

export type SwapSigningStepKind = "token_approval" | "permit2" | "typed_data" | "transaction";

/** Next wallet action for Intent MCP — approval tx before Permit2 when both are present. */
export function resolveSwapSigningStep(
  instructions: SigningInstructions,
  quotedTokenAddress?: string,
): SwapSigningStepKind {
  const phase = String(instructions.phase ?? "").toLowerCase();
  if (phase === "token_approval") return "token_approval";

  const payloads = signingPayloadsFromInstructions(instructions);
  const approveTxs = collectApproveTransactions(instructions, quotedTokenAddress);
  if (payloads.length > 0 && approveTxs.length > 0) return "token_approval";
  if (payloads.length > 0) {
    return payloads.some(isPermit2TypedDataPayload) ? "permit2" : "typed_data";
  }
  if (approveTxs.length > 0) return "token_approval";

  const swapTxs = collectSwapExecutionTransactions(instructions, quotedTokenAddress);
  if (swapTxs.length > 0) return "transaction";

  const type = String(instructions.type ?? "").toLowerCase();
  if (type === "transaction") return "transaction";

  throw new Error("No wallet signing step in Intent MCP instructions — request a new quote.");
}

export type SwapSignResult =
  | { kind: "tx_hash"; value: string }
  | { kind: "signature"; value: string; signedTypedData?: WalletTypedDataPayload };

/** True when instructions include an on-chain swap execution tx (e.g. Uniswap Universal Router). */
export function hasSwapExecutionTransaction(
  instructions: SigningInstructions,
  quotedTokenAddress?: string,
): boolean {
  return collectSwapExecutionTransactions(instructions, quotedTokenAddress).length > 0;
}

export function hasPendingApprovalTransaction(
  instructions: SigningInstructions,
  expectedPermit?: ExpectedPermit,
): boolean {
  if (
    expectedPermit?.tokenAddress &&
    collectApproveTransactions(instructions, expectedPermit.tokenAddress).length > 0
  ) {
    return true;
  }
  return mayRequirePermit2Approval(instructions, expectedPermit);
}

function resolvePermit2ApprovalContext(
  instructions: SigningInstructions,
  expectedPermit?: ExpectedPermit,
): Permit2ApprovalContext | undefined {
  let tokenAddress = expectedPermit?.tokenAddress;
  let requiredAmount = BigInt(0);

  if (expectedPermit?.amountAtomic) {
    try {
      requiredAmount = BigInt(expectedPermit.amountAtomic);
    } catch {
      /* ignore */
    }
  }

  for (const payload of signingPayloadsFromInstructions(instructions)) {
    if (!isPermit2TypedDataPayload(payload)) continue;
    const permitted = payload.message.permitted as { token?: string; amount?: unknown } | undefined;
    if (permitted?.token && permitted.amount != null) {
      tokenAddress = tokenAddress ?? permitted.token;
      try {
        const permitAmount = BigInt(String(permitted.amount));
        if (permitAmount > requiredAmount) requiredAmount = permitAmount;
      } catch {
        /* ignore */
      }
    }
  }

  if (!tokenAddress || isNativeEthTokenAddress(tokenAddress) || requiredAmount <= BigInt(0)) {
    return undefined;
  }

  return {
    tokenAddress,
    amountAtomic: requiredAmount.toString(),
    chainId: expectedPermit?.chainId,
  };
}

export function mayRequirePermit2Approval(
  instructions: SigningInstructions,
  expectedPermit?: ExpectedPermit,
): boolean {
  if (expectedPermit?.tokenAddress && isNativeEthTokenAddress(expectedPermit.tokenAddress)) {
    return false;
  }
  const payloads = signingPayloadsFromInstructions(instructions);
  if (payloads.some(isPermit2TypedDataPayload)) {
    return resolvePermit2ApprovalContext(instructions, expectedPermit) != null;
  }
  if (
    expectedPermit?.tokenAddress &&
    hasSwapExecutionTransaction(instructions, expectedPermit.tokenAddress)
  ) {
    return true;
  }
  return false;
}

export function signingPayloadsFromInstructions(instructions: SigningInstructions): TypedDataPayload[] {
  const fromApi = instructions.signingPayloads;
  if (Array.isArray(fromApi) && fromApi.length > 0) {
    return fromApi as TypedDataPayload[];
  }

  if (instructions.domain && instructions.types && instructions.message && instructions.primaryType) {
    return [
      {
        domain: instructions.domain as Record<string, unknown>,
        types: instructions.types as Record<string, unknown>,
        message: instructions.message as Record<string, unknown>,
        primaryType: String(instructions.primaryType),
      },
    ];
  }

  return [];
}

function walletTypedDataPayload(payload: TypedDataPayload): WalletTypedDataPayload {
  return prepareTypedDataForWallet(payload as WalletTypedDataPayload);
}

function extractWitnessSwapper(message: Record<string, unknown>): string | undefined {
  const witness = message.witness;
  if (!witness || typeof witness !== "object") return undefined;
  const w = witness as Record<string, unknown>;
  if (typeof w.swapper === "string" && isAddress(w.swapper)) return w.swapper;
  const info = w.info;
  if (info && typeof info === "object") {
    const swapper = (info as Record<string, unknown>).swapper;
    if (typeof swapper === "string" && isAddress(swapper)) return swapper;
  }
  return undefined;
}

/** Expected EIP-712 signer from order fields (UniswapX witness.swapper, CoW maker, etc.). */
export function resolveOrderAccountFromPayload(
  payload: TypedDataPayload,
  walletAddress: string,
): string {
  const message = payload.message;
  const witnessSwapper = extractWitnessSwapper(message);
  const orderFields = payload.types?.Order;
  const hasMakerField = Array.isArray(orderFields) && orderFields.some((f) => f.name === "maker");
  const maker = hasMakerField && typeof message.maker === "string" ? message.maker : undefined;
  const receiver = typeof message.receiver === "string" ? message.receiver : undefined;
  const owner = typeof message.owner === "string" ? message.owner : undefined;
  const expected = witnessSwapper ?? maker ?? receiver ?? owner;

  if (expected && isAddress(expected)) {
    if (getAddress(walletAddress) !== getAddress(expected)) {
      throw new SwapApiError(
        `Connected wallet (${getAddress(walletAddress)}) does not match the swap order account (${getAddress(expected)}). ` +
          "Switch to that account in MetaMask, request a new quote, and confirm within 60 seconds.",
        "WALLET_ACCOUNT_MISMATCH",
      );
    }
    return getAddress(expected);
  }

  return getAddress(walletAddress);
}

function resolveSignerAddress(payload: TypedDataPayload, walletAddress: string): string {
  return resolveOrderAccountFromPayload(payload, walletAddress);
}

export function lastPermit2PayloadFromInstructions(
  instructions: SigningInstructions,
): TypedDataPayload | undefined {
  const payloads = signingPayloadsFromInstructions(instructions);
  for (let i = payloads.length - 1; i >= 0; i--) {
    const payload = payloads[i];
    if (payload && isPermit2TypedDataPayload(payload)) return payload;
  }
  return payloads[payloads.length - 1];
}

/** Recover the Ethereum address that signed a Permit2 EIP-712 payload. */
export async function recoverPermit2Signer(
  payload: TypedDataPayload,
  signature: string,
  signedTypedData?: WalletTypedDataPayload,
): Promise<string> {
  const normalized = normalizePermitSignature(signature);
  const typedData = signedTypedData ?? walletTypedDataPayload(payload);
  const candidates: WalletTypedDataPayload[] = [
    typedData,
    JSON.parse(JSON.stringify(typedData)) as WalletTypedDataPayload,
  ];
  for (const td of candidates) {
    try {
      return recoverMetaMaskTypedDataSigner(td, normalized);
    } catch {
      /* MetaMask recovery failed — try viem (WalletConnect / non-MetaMask wallets) */
    }
    try {
      const recovered = await recoverTypedDataAddress({
        domain: td.domain as Parameters<typeof recoverTypedDataAddress>[0]["domain"],
        types: td.types as Parameters<typeof recoverTypedDataAddress>[0]["types"],
        primaryType: td.primaryType as Parameters<typeof recoverTypedDataAddress>[0]["primaryType"],
        message: td.message as Parameters<typeof recoverTypedDataAddress>[0]["message"],
        signature: normalized as `0x${string}`,
      });
      return getAddress(recovered);
    } catch {
      /* try next candidate */
    }
  }
  throw new SwapApiError(
    "Could not recover Permit2 signer from signature.",
    "WALLET_ACCOUNT_MISMATCH",
  );
}

export type TypedDataSignResult = {
  signature: string;
  /** Exact EIP-712 payload passed to MetaMask — use for recovery (must match what was signed). */
  signedTypedData: WalletTypedDataPayload;
};

function parseWalletSignature(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object") {
    const sig = (raw as { signature?: unknown }).signature;
    if (typeof sig === "string") return sig.trim();
  }
  throw new SwapApiError(
    "Wallet returned an invalid signature format. Confirm the Permit2 EIP-712 prompt (Sign typed data), not an ERC20 approval transaction.",
    "WALLET_ACCOUNT_MISMATCH",
  );
}

function typedDataVerifyArgs(td: WalletTypedDataPayload) {
  return {
    domain: td.domain as Parameters<typeof verifyTypedData>[0]["domain"],
    types: td.types as Parameters<typeof verifyTypedData>[0]["types"],
    primaryType: td.primaryType as Parameters<typeof verifyTypedData>[0]["primaryType"],
    message: td.message as Parameters<typeof verifyTypedData>[0]["message"],
  };
}

function isSamePermit2SignedPayload(
  signed: WalletTypedDataPayload,
  permit: WalletTypedDataPayload,
): boolean {
  return signed.domain?.name === "Permit2" && signed.primaryType === permit.primaryType;
}

/** True when signature validates for connected wallet against the exact payload sent to MetaMask. */
export async function verifyPermit2SignatureForWallet(
  signedTypedData: WalletTypedDataPayload,
  signature: string,
  connectedWallet: string,
): Promise<boolean> {
  const connected = getAddress(connectedWallet);
  const normalized = normalizePermitSignature(signature) as `0x${string}`;
  const candidates: WalletTypedDataPayload[] = [
    signedTypedData,
    JSON.parse(JSON.stringify(signedTypedData)) as WalletTypedDataPayload,
  ];
  for (const td of candidates) {
    if (verifyMetaMaskTypedDataSigner(td, normalized, connected)) {
      return true;
    }
    try {
      if (
        await verifyTypedData({
          address: connected,
          ...typedDataVerifyArgs(td),
          signature: normalized,
        })
      ) {
        return true;
      }
    } catch {
      /* try next candidate encoding */
    }
  }
  return false;
}

async function assertPermit2SignatureForConnectedWallet(
  signedTypedData: WalletTypedDataPayload,
  signature: string,
  connectedWallet: string,
): Promise<void> {
  const connected = getAddress(connectedWallet);
  const verified = await verifyPermit2SignatureForWallet(signedTypedData, signature, connected);
  if (verified) {
    return;
  }

  let recoveredSigner: string | undefined;
  try {
    recoveredSigner = recoverMetaMaskTypedDataSigner(signedTypedData, normalizePermitSignature(signature));
  } catch {
    try {
      recoveredSigner = getAddress(
        await recoverTypedDataAddress({
          domain: signedTypedData.domain as Parameters<typeof recoverTypedDataAddress>[0]["domain"],
          types: signedTypedData.types as Parameters<typeof recoverTypedDataAddress>[0]["types"],
          primaryType: signedTypedData.primaryType as Parameters<typeof recoverTypedDataAddress>[0]["primaryType"],
          message: signedTypedData.message as Parameters<typeof recoverTypedDataAddress>[0]["message"],
          signature: normalizePermitSignature(signature) as `0x${string}`,
        }),
      );
    } catch {
      recoveredSigner = undefined;
    }
  }

  const accountHint =
    recoveredSigner && recoveredSigner !== connected
      ? `MetaMask signed as ${recoveredSigner}, not ${connected}. If the account verification message signed correctly, you switched accounts in the Permit2 popup — use ${connected} for every MetaMask prompt in this swap. `
      : "";

  throw new SwapApiError(
    `Permit2 signature does not verify for your connected wallet (${connected}). ${accountHint}` +
      "The ERC20 approval and Permit2 signature must use the same address — approve USDC from this wallet, then sign the Permit2 typed-data prompt (no gas) from the same account. " +
      "If you confirmed a transaction when the app expected a signature, request a fresh quote and watch for two different MetaMask prompts: (1) Approve USDC transaction, (2) Sign Permit2 message. " +
      walletConnectionHint(),
    "WALLET_ACCOUNT_MISMATCH",
  );
}

export type Permit2SubmitWallet = {
  submitWallet: string;
  recoveredSigner: string;
  /** True when MetaMask signed with a different account than the quote wallet. */
  corrected: boolean;
  quoteWallet?: string;
};

/**
 * Resolve submit wallet from Permit2 signature — heals account mismatch via sync_permit_signer on submit.
 */
export async function resolvePermit2SubmitWallet(
  payload: TypedDataPayload,
  signature: string,
  connectedWallet: string,
  signedTypedData?: WalletTypedDataPayload,
): Promise<Permit2SubmitWallet> {
  const connected = getAddress(connectedWallet);
  const permitTypedData = walletTypedDataPayload(payload);
  const verifyTypedData =
    signedTypedData && isSamePermit2SignedPayload(signedTypedData, permitTypedData)
      ? signedTypedData
      : permitTypedData;

  const verifiedForConnected = await verifyPermit2SignatureForWallet(
    verifyTypedData,
    signature,
    connected,
  );
  if (verifiedForConnected) {
    return {
      submitWallet: connected,
      recoveredSigner: connected,
      corrected: false,
      quoteWallet: connected,
    };
  }

  if (
    signedTypedData &&
    !isSamePermit2SignedPayload(signedTypedData, permitTypedData)
  ) {
    throw new SwapApiError(
      `Permit2 signature does not verify for your connected wallet (${connected}). ${walletConnectionHint()}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  let recoveredSigner: string;
  try {
    recoveredSigner = getAddress(
      await recoverPermit2Signer(payload, signature, verifyTypedData),
    );
  } catch {
    throw new SwapApiError(
      `Permit2 signature does not verify for your connected wallet (${connected}). ${walletConnectionHint()}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  const verifiedRecovered = await verifyPermit2SignatureForWallet(
    verifyTypedData,
    signature,
    recoveredSigner,
  );
  if (!verifiedRecovered) {
    throw new SwapApiError(
      `Permit2 signature does not verify for your connected wallet (${connected}). ${walletConnectionHint()}`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }

  if (recoveredSigner === connected) {
    return {
      submitWallet: connected,
      recoveredSigner: connected,
      corrected: false,
      quoteWallet: connected,
    };
  }

  return {
    submitWallet: recoveredSigner,
    recoveredSigner,
    corrected: true,
    quoteWallet: connected,
  };
}

/** Ensure Permit2 signature came from the connected wallet before submit. */
export async function assertPermit2SignatureMatchesWallet(
  payload: TypedDataPayload,
  signature: string,
  connectedWallet?: string,
  signedTypedData?: WalletTypedDataPayload,
): Promise<string> {
  if (!connectedWallet) {
    return recoverPermit2Signer(payload, signature, signedTypedData);
  }
  const resolved = await resolvePermit2SubmitWallet(
    payload,
    signature,
    connectedWallet,
    signedTypedData,
  );
  return resolved.submitWallet;
}

function isMissingReactorSignError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return /missing value for field reactor/i.test(message);
}

async function signTypedDataPayload(
  provider: NonNullable<Window["ethereum"]>,
  address: string,
  payload: TypedDataPayload,
  chainId?: number,
): Promise<TypedDataSignResult> {
  validateTypedDataForWallet(payload as WalletTypedDataPayload);
  const typedData = walletTypedDataPayload(payload);
  const typedDataJson = JSON.stringify(typedData);
  const signedTypedData = JSON.parse(typedDataJson) as WalletTypedDataPayload;
  const bound = getBoundConnectedAddress();
  const signer = bound ? getAddress(bound) : resolveSignerAddress(payload, address);
  resolveOrderAccountFromPayload(payload, signer);
  if (isPermit2TypedDataPayload(payload)) {
    await preparePermit2SigningAccount(signer);
  } else {
    await lockSigningAccount(signer);
  }
  await assertActiveWalletMatches(signer);
  let signature: string;
  try {
    signature = parseWalletSignature(
      await provider.request({
        method: "eth_signTypedData_v4",
        params: [signer, typedDataJson],
      }),
    );
  } catch (err) {
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(chainId));
    }
    if (!isWalletInvalidInputError(err)) throw err;
    signature = parseWalletSignature(
      await provider.request({
        method: "eth_signTypedData_v4",
        params: [signer, signedTypedData],
      }),
    );
  }
  const normalized = normalizePermitSignature(signature);
  if (isPermit2TypedDataPayload(payload)) {
    if (!PERMIT2_ECDSA_SIG_RE.test(normalized)) {
      throw new SwapApiError(
        "Wallet did not return a valid Permit2 signature. Confirm the EIP-712 Permit2 prompt — not an ERC20 approval transaction.",
        "WALLET_ACCOUNT_MISMATCH",
      );
    }
  }
  return { signature: normalized, signedTypedData };
}

function isWalletInvalidInputError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return code === -32000 || /invalid input/i.test(message);
}

const QUOTE_CONFIRMATION_PREFIX = "MetaLift Intent Quote Confirmation";

/** personal_sign for Intent MCP quote authorization (not swap execution). */
export async function signQuoteConfirmationMessage(
  message: string,
  walletAddress: string,
  chainId?: number,
): Promise<string> {
  if (!message.includes(QUOTE_CONFIRMATION_PREFIX)) {
    throw new Error("Refusing to sign — message is not a MetaLift quote confirmation.");
  }
  const provider = resolveWalletProviderOrThrow();

  const signer = await lockSigningAccount(walletAddress);

  if (chainId != null) {
    await ensureWalletNetworkForSwap(provider, chainId);
  }

  try {
    return (await provider.request({
      method: "personal_sign",
      params: [message, signer],
    })) as string;
  } catch (err) {
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(chainId));
    }
    throw err;
  }
}

async function signTokenApprovalStep(
  provider: NonNullable<Window["ethereum"]>,
  signer: string,
  instructions: SigningInstructions,
  apiUrl?: string,
  chainId?: number,
  expectedQuote?: ExpectedSwapQuote,
): Promise<string> {
  const permitCtx = expectedQuote
    ? { tokenAddress: expectedQuote.tokenInAddress, amountAtomic: expectedQuote.amountInAtomic, chainId }
    : undefined;
  const usesPermit2Erc20 =
    permitCtx != null && !isNativeEthTokenAddress(permitCtx.tokenAddress);
  const proactiveApproveTx =
    usesPermit2Erc20
      ? await prepareApproveTransactionIfNeeded(provider, signer, permitCtx, apiUrl)
      : undefined;

  const txHash = await sendSwapOnChainTransactions(
    provider,
    signer,
    instructions,
    apiUrl,
    chainId,
    expectedQuote?.tokenInAddress,
    false,
    proactiveApproveTx,
    expectedQuote?.amountInAtomic,
    true,
  );
  if (!txHash) {
    throw new Error(
      "Token approval transaction was not broadcast. Confirm the ERC20 approve prompt in MetaMask (transaction — not Sign typed data).",
    );
  }
  return txHash;
}

async function signSwapExecutionStep(
  provider: NonNullable<Window["ethereum"]>,
  signer: string,
  instructions: SigningInstructions,
  apiUrl?: string,
  chainId?: number,
  expectedQuote?: ExpectedSwapQuote,
): Promise<string> {
  const txHash = await sendSwapOnChainTransactions(
    provider,
    signer,
    instructions,
    apiUrl,
    chainId,
    expectedQuote?.tokenInAddress,
    true,
    undefined,
    expectedQuote?.amountInAtomic,
    false,
  );
  if (!txHash) {
    throw new Error("Swap execution transaction was not broadcast — check your wallet.");
  }
  return txHash;
}

async function signTypedDataStep(
  provider: NonNullable<Window["ethereum"]>,
  signer: string,
  instructions: SigningInstructions,
  expectedQuote?: ExpectedSwapQuote,
  chainId?: number,
): Promise<SwapSignResult> {
  const payloads = signingPayloadsFromInstructions(instructions);
  if (payloads.length === 0) {
    throw new Error("No EIP-712 signing payload in Intent MCP instructions.");
  }
  if (expectedQuote) {
    validateSwapQuoteAgainstInstructions(instructions, expectedQuote);
  }
  for (const payload of payloads) {
    resolveOrderAccountFromPayload(payload, signer);
  }

  let lastSigned: TypedDataSignResult | undefined;
  let lastPermit2Signed: TypedDataSignResult | undefined;
  try {
    for (const payload of payloads) {
      await lockSigningAccount(signer);
      const signed = await signTypedDataPayload(provider, signer, payload, chainId);
      lastSigned = signed;
      if (isPermit2TypedDataPayload(payload)) {
        lastPermit2Signed = signed;
      }
    }
  } catch (err) {
    if (isWalletInvalidInputError(err)) {
      throw new Error(
        "Wallet rejected the signing payload (Invalid input). Request a fresh quote and try again, or use a different wallet.",
      );
    }
    if (isMissingReactorSignError(err)) {
      throw new Error(
        "Wallet rejected the swap signature (missing reactor address in the order). Request a fresh quote and try again.",
      );
    }
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(chainId));
    }
    throw err;
  }
  if (!lastSigned) {
    throw new Error("No signature returned from wallet.");
  }

  const permitPayload = lastPermit2PayloadFromInstructions(instructions) ?? payloads[payloads.length - 1];
  const submitSigned = lastPermit2Signed ?? lastSigned;
  if (permitPayload && isPermit2TypedDataPayload(permitPayload)) {
    await assertPermit2SignatureMatchesWallet(
      permitPayload,
      submitSigned.signature,
      signer,
      submitSigned.signedTypedData,
    );
  }

  return {
    kind: "signature",
    value: submitSigned.signature,
    signedTypedData: submitSigned.signedTypedData,
  };
}

/** Sign one Intent MCP wallet step — approval tx, Permit2 EIP-712, or swap execution tx. */
export async function signSwapSignStep(
  instructions: SigningInstructions,
  walletAddress: string,
  expectedQuote?: ExpectedSwapQuote,
  chainId?: number,
  apiUrl?: string,
): Promise<SwapSignResult> {
  const provider = resolveWalletProviderOrThrow();
  const signer = await lockSigningAccount(walletAddress);

  if (chainId != null) {
    await ensureWalletNetworkForSwap(provider, chainId);
  }

  const step = resolveSwapSigningStep(instructions, expectedQuote?.tokenInAddress);

  switch (step) {
    case "token_approval": {
      const txHash = await signTokenApprovalStep(
        provider,
        signer,
        instructions,
        apiUrl,
        chainId,
        expectedQuote,
      );
      return { kind: "tx_hash", value: txHash };
    }
    case "permit2":
    case "typed_data":
      return signTypedDataStep(provider, signer, instructions, expectedQuote, chainId);
    case "transaction": {
      const txHash = await signSwapExecutionStep(
        provider,
        signer,
        instructions,
        apiUrl,
        chainId,
        expectedQuote,
      );
      return { kind: "tx_hash", value: txHash };
    }
    default:
      throw new Error("No wallet signing step in Intent MCP instructions — request a new quote.");
  }
}

/** @deprecated Prefer signSwapSignStep — runs a single MCP signing phase per call. */
export async function signSwapInstructions(
  instructions: SigningInstructions,
  walletAddress: string,
  expectedQuote?: ExpectedSwapQuote,
  chainId?: number,
  apiUrl?: string,
): Promise<string> {
  const result = await signSwapSignStep(instructions, walletAddress, expectedQuote, chainId, apiUrl);
  return result.value;
}

export { isWalletInvalidInputError };
