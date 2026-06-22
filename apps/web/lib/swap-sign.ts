import type { SigningInstructions } from "./swap-api";
import { assertSinglePermittedAccount, SwapApiError } from "./swap-api";
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
import { getAddress, isAddress, recoverTypedDataAddress } from "viem";

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
  const allTxs = [...approveTxs, ...swapTxs].map((tx) => normalizeTx(tx, walletAddress));

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

/** Recover Permit2 signer and ensure it matches the live connected wallet before submit. */
export async function assertPermit2SignatureMatchesWallet(
  payload: TypedDataPayload,
  signature: string,
  liveWallet?: string,
): Promise<string> {
  const normalized = normalizePermitSignature(signature);
  const typedData = walletTypedDataPayload(payload);
  const recovered = await recoverTypedDataAddress({
    domain: typedData.domain as Parameters<typeof recoverTypedDataAddress>[0]["domain"],
    types: typedData.types as Parameters<typeof recoverTypedDataAddress>[0]["types"],
    primaryType: typedData.primaryType as Parameters<typeof recoverTypedDataAddress>[0]["primaryType"],
    message: typedData.message as Parameters<typeof recoverTypedDataAddress>[0]["message"],
    signature: normalized as `0x${string}`,
  });

  const signer = getAddress(recovered);
  if (liveWallet && getAddress(liveWallet) !== signer) {
    throw new SwapApiError(
      `Permit2 was signed by ${signer} but this swap requires ${getAddress(liveWallet)}. ` +
        `Your MetaMask active account is likely ${signer}. Click Connect Wallet while ${getAddress(liveWallet)} is selected in MetaMask, request a new quote, and in the Permit2 popup verify the account before Confirm.`,
      "WALLET_ACCOUNT_MISMATCH",
    );
  }
  return signer;
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
): Promise<string> {
  validateTypedDataForWallet(payload as WalletTypedDataPayload);
  const typedData = walletTypedDataPayload(payload);
  const typedDataJson = JSON.stringify(typedData);
  const signer = resolveSignerAddress(payload, address);
  await assertSinglePermittedAccount(signer);
  let signature: string;
  try {
    signature = (await provider.request({
      method: "eth_signTypedData_v4",
      params: [signer, typedDataJson],
    })) as string;
  } catch (err) {
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(chainId));
    }
    if (!isWalletInvalidInputError(err)) throw err;
    signature = (await provider.request({
      method: "eth_signTypedData_v4",
      params: [signer, typedDataJson],
    })) as string;
  }
  if (isPermit2TypedDataPayload(payload)) {
    await assertPermit2SignatureMatchesWallet(payload, signature, signer);
  }
  return signature;
}

async function signStep(
  provider: NonNullable<Window["ethereum"]>,
  address: string,
  step: SigningInstructions,
  walletTxOptions?: { apiUrl?: string; chainId?: number; allowedTokenAddress?: string },
): Promise<string> {
  const method = (step.method ?? step.type ?? "").toLowerCase();

  if (method.includes("typed") || step.typedData || step.eip712 || step.domain) {
    if (method && !method.includes("typed") && method !== "eth_signtypeddata_v4") {
      throw new Error(`Unsupported signing method "${step.method ?? step.type}" — only EIP-712 typed data is allowed for swaps.`);
    }
    return signTypedDataPayload(provider, address, buildTypedDataPayload(step), walletTxOptions?.chainId);
  }

  const tx = (step.transaction ?? step.tx) as Record<string, unknown> | undefined;
  if (method.includes("transaction") || method === "eth_sendtransaction" || tx) {
    if (method && method !== "eth_sendtransaction" && !method.includes("transaction")) {
      throw new Error(`Unsupported signing method "${step.method ?? step.type}" — only eth_sendTransaction is allowed.`);
    }
    if (!tx) throw new Error("Transaction signing requested but no transaction payload");
    if (walletTxOptions?.allowedTokenAddress && isErc20ApproveTransaction(tx)) {
      validateSwapApprovalTransaction(tx, walletTxOptions.allowedTokenAddress);
    }
    return sendWalletTransaction(provider, address, normalizeTx(tx, address), walletTxOptions);
  }

  if (method.includes("personal") || step.personalMessage) {
    throw new Error("personal_sign is not allowed for swap intents — request a new quote.");
  }

  if (Array.isArray(step.params) && step.params.length > 0 && step.method) {
    throw new Error(`Unsupported signing method "${step.method}" — swap signing is restricted to EIP-712 and approve transactions.`);
  }

  throw new Error("Unsupported signing step from Intent MCP");
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
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet provider — connect your wallet first");

  const signer = await assertSinglePermittedAccount(walletAddress);

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

/** Sign swap intent in the connected wallet; may require approval tx then EIP-712 signature. */
export async function signSwapInstructions(
  instructions: SigningInstructions,
  walletAddress: string,
  expectedQuote?: ExpectedSwapQuote,
  chainId?: number,
  apiUrl?: string,
): Promise<string> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet provider — connect your wallet first");

  const signer = await assertSinglePermittedAccount(walletAddress);

  if (chainId != null) {
    await ensureWalletNetworkForSwap(provider, chainId);
  }

  const permitCtx = expectedQuote
    ? { tokenAddress: expectedQuote.tokenInAddress, amountAtomic: expectedQuote.amountInAtomic, chainId }
    : undefined;
  const payloads = signingPayloadsFromInstructions(instructions);
  const usesPermit2Erc20 =
    permitCtx != null && !isNativeEthTokenAddress(permitCtx.tokenAddress);
  const ranPermit2TypedData = payloads.some(isPermit2TypedDataPayload);
  const proactiveApproveTx =
    usesPermit2Erc20
      ? await prepareApproveTransactionIfNeeded(provider, signer, permitCtx, apiUrl)
      : undefined;
  const skipInstructionApproves = Boolean(
    usesPermit2Erc20 && (ranPermit2TypedData || proactiveApproveTx),
  );

  const executionTxHash = await sendSwapOnChainTransactions(
    provider,
    signer,
    instructions,
    apiUrl,
    chainId,
    expectedQuote?.tokenInAddress,
    skipInstructionApproves,
    proactiveApproveTx,
    expectedQuote?.amountInAtomic,
  );

  if (payloads.length > 0) {
    if (expectedQuote) {
      validateSwapQuoteAgainstInstructions(instructions, expectedQuote);
    }
    for (const payload of payloads) {
      resolveOrderAccountFromPayload(payload, signer);
    }
    let lastSignature = "";
    try {
      for (const payload of payloads) {
        await assertSinglePermittedAccount(signer);
        lastSignature = await signTypedDataPayload(provider, signer, payload, chainId);
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
    const normalizedPermitSig = normalizePermitSignature(lastSignature);
    if (!PERMIT2_ECDSA_SIG_RE.test(normalizedPermitSig)) {
      throw new Error(
        "Wallet did not return a valid Permit2 signature. Sign the EIP-712 permit prompt (not the ERC20 approval transaction), then try again.",
      );
    }
    const lastPayload = payloads[payloads.length - 1];
    if (lastPayload) {
      await assertPermit2SignatureMatchesWallet(lastPayload, normalizedPermitSig, signer);
    }
    return normalizedPermitSig;
  }

  if (executionTxHash) return executionTxHash;

  const walletTxOptions =
    apiUrl && chainId != null
      ? { apiUrl, chainId, allowedTokenAddress: expectedQuote?.tokenInAddress }
      : expectedQuote?.tokenInAddress
        ? { allowedTokenAddress: expectedQuote.tokenInAddress }
        : undefined;

  if (Array.isArray(instructions.steps)) {
    const walletSteps = instructions.steps.filter(
      (step): step is SigningInstructions => typeof step === "object" && step !== null,
    );
    if (walletSteps.length > 0) {
      let lastSignature = executionTxHash;
      for (const step of walletSteps) {
        if (extractTxRecord(step)) continue;
        lastSignature = await signStep(provider, signer, step, walletTxOptions);
      }
      return lastSignature;
    }
  }

  if (extractTxRecord(instructions)) {
    return signStep(provider, signer, instructions, walletTxOptions);
  }

  throw new Error("No wallet signing step in Intent MCP instructions — request a new quote.");
}

export { isWalletInvalidInputError };
