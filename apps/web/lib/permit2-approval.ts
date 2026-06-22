import { encodeFunctionData, erc20Abi, getAddress, maxUint256, type Address } from "viem";
import { chainRpcCall } from "./chain-rpc";
import { ensureWalletNetworkForSwap } from "./wallet-network";
import { sendWalletTransaction } from "./wallet-tx";

/** Canonical Permit2 contract — same address on all EVM chains. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

const NATIVE_ETH_SENTINELS = new Set([
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000000000",
]);

export type Permit2ApprovalContext = {
  tokenAddress: string;
  amountAtomic: string;
  chainId?: number;
};

export type Permit2ApprovalOptions = {
  apiUrl?: string;
  waitForConfirmation: (txHash: string) => Promise<void>;
};

export function isNativeEthTokenAddress(tokenAddress: string): boolean {
  try {
    return NATIVE_ETH_SENTINELS.has(getAddress(tokenAddress).toLowerCase());
  } catch {
    return false;
  }
}

export function isPermit2TypedDataPayload(payload: {
  domain?: Record<string, unknown>;
  primaryType?: string;
}): boolean {
  const domainName = payload.domain?.name;
  if (typeof domainName === "string" && domainName.toLowerCase() === "permit2") return true;
  const primaryType = payload.primaryType ?? "";
  return (
    primaryType === "PermitWitnessTransferFrom" ||
    primaryType === "PermitTransferFrom" ||
    primaryType === "PermitSingle"
  );
}

export function isWalletRpcHttpError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  const httpStatus =
    "data" in err &&
    err.data &&
    typeof err.data === "object" &&
    "httpStatus" in (err.data as Record<string, unknown>)
      ? (dataHttpStatus(err.data as Record<string, unknown>))
      : undefined;
  return (
    code === -32080 ||
    httpStatus === 403 ||
    /RPC endpoint returned HTTP client error/i.test(message)
  );
}

function dataHttpStatus(data: Record<string, unknown>): number | undefined {
  const direct = data.httpStatus;
  if (typeof direct === "number") return direct;
  const cause = data.cause;
  if (cause && typeof cause === "object" && "httpStatus" in (cause as Record<string, unknown>)) {
    const nested = (cause as { httpStatus?: number }).httpStatus;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}

export function walletRpcErrorMessage(chainId?: number): string {
  const pocketRpc =
    chainId === 8453
      ? "https://base.api.pocket.network"
      : chainId === 137
        ? "https://poly.api.pocket.network"
        : chainId === 42161
          ? "https://arb-one.api.pocket.network"
          : "https://eth.api.pocket.network";
  return (
    `Your wallet's network RPC returned HTTP 403 (blocked or rate-limited). ` +
    `In MetaMask: Settings → Networks → edit this network → set RPC URL to ${pocketRpc}, save, then retry. ` +
    `Or choose Gasless / Best price in swap settings to avoid on-chain approval transactions.`
  );
}

function allowanceCallData(owner: Address): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, PERMIT2_ADDRESS],
  });
}

async function readErc20AllowanceViaApi(
  apiUrl: string,
  chainId: number,
  tokenAddress: Address,
  owner: Address,
): Promise<bigint> {
  const data = allowanceCallData(owner);
  const result = await chainRpcCall(apiUrl, chainId, "eth_call", [{ to: tokenAddress, data }, "latest"]);
  return BigInt(String(result));
}

/** Read ERC20 allowance(owner → Permit2). */
export async function readPermit2Erc20Allowance(
  apiUrl: string,
  chainId: number,
  tokenAddress: string,
  ownerAddress: string,
): Promise<bigint> {
  const token = getAddress(tokenAddress);
  const owner = getAddress(ownerAddress);
  return readErc20AllowanceViaApi(apiUrl, chainId, token, owner);
}

export async function assertPermit2Erc20Allowance(
  apiUrl: string,
  chainId: number,
  walletAddress: string,
  ctx: Permit2ApprovalContext,
  willSendApproveTx: boolean,
): Promise<void> {
  if (isNativeEthTokenAddress(ctx.tokenAddress) || willSendApproveTx) return;

  let required: bigint;
  try {
    required = BigInt(ctx.amountAtomic);
  } catch {
    return;
  }

  let allowance: bigint;
  try {
    allowance = await readPermit2Erc20Allowance(apiUrl, chainId, ctx.tokenAddress, walletAddress);
  } catch {
    return;
  }

  if (allowance < required) {
    throw new Error(
      "This swap needs a one-time token approval to Permit2 before Uniswap can execute. " +
        "Request a fresh quote — your wallet should prompt for approval first, then the swap. " +
        "Do not confirm only the Uniswap execute transaction.",
    );
  }
}

function buildApproveTransaction(
  tokenAddress: Address,
  walletAddress: Address,
  chainId?: number,
): Record<string, unknown> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [PERMIT2_ADDRESS, maxUint256],
  });
  const tx: Record<string, unknown> = {
    from: walletAddress,
    to: tokenAddress,
    data,
    value: "0x0",
  };
  if (chainId != null) {
    tx.chainId = chainId;
  }
  return tx;
}

/** Build approve(Permit2) tx when allowance is below the swap amount; does not send. */
export async function prepareApproveTransactionIfNeeded(
  provider: NonNullable<Window["ethereum"]>,
  walletAddress: string,
  ctx: Permit2ApprovalContext,
  apiUrl?: string,
): Promise<Record<string, unknown> | undefined> {
  if (isNativeEthTokenAddress(ctx.tokenAddress)) return undefined;

  let token: Address;
  let owner: Address;
  try {
    token = getAddress(ctx.tokenAddress);
    owner = getAddress(walletAddress);
  } catch {
    return undefined;
  }

  let required: bigint;
  try {
    required = BigInt(ctx.amountAtomic);
  } catch {
    return undefined;
  }

  if (ctx.chainId != null) {
    await ensureWalletNetworkForSwap(provider, ctx.chainId);
  }

  let allowance: bigint | null = null;
  if (apiUrl && ctx.chainId != null) {
    try {
      allowance = await readErc20AllowanceViaApi(apiUrl, ctx.chainId, token, owner);
    } catch {
      /* Pocket read failed — proceed with approve to be safe */
    }
  }
  if (allowance != null && allowance >= required) return undefined;

  return buildApproveTransaction(token, owner, ctx.chainId);
}

/** Send ERC20 approve(Permit2, max) when allowance is below the swap amount. */
export async function ensurePermit2Allowance(
  provider: NonNullable<Window["ethereum"]>,
  walletAddress: string,
  ctx: Permit2ApprovalContext,
  options: Permit2ApprovalOptions,
): Promise<string | undefined> {
  const tx = await prepareApproveTransactionIfNeeded(provider, walletAddress, ctx, options.apiUrl);
  if (!tx) return undefined;

  const txHash = await sendWalletTransaction(provider, walletAddress, tx, {
    apiUrl: options.apiUrl,
    chainId: ctx.chainId,
  });

  await options.waitForConfirmation(txHash);
  return txHash;
}
