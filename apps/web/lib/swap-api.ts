import { ensureSessionToken, sessionHeaders } from "./session";

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

export async function prepareSwap(
  apiUrl: string,
  quoteId: string,
  walletAddress: string,
  expectedPermit?: { tokenAddress: string; amountAtomic: string },
  requote?: {
    fromChain: number;
    toChain?: number;
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippageBps?: number;
    executionMode?: "any" | "gasless" | "gas";
  },
): Promise<{ intentId: string; signingInstructions: SigningInstructions }> {
  const res = await swapFetch(apiUrl, "/swap/prepare", {
    quoteId,
    walletAddress,
    expectedPermit,
    requote,
  });
  const json = (await res.json()) as {
    error?: string;
    code?: string;
    intentId?: string;
    signingInstructions?: SigningInstructions;
  };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Prepare failed (${res.status})`, json.code, res.status);
  }
  if (!json.intentId || !json.signingInstructions) {
    throw new Error("Invalid prepare response from server");
  }
  return { intentId: json.intentId, signingInstructions: json.signingInstructions };
}

export async function submitSwap(
  apiUrl: string,
  intentId: string,
  signature: string,
  metadata?: {
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    chainName?: string;
  },
): Promise<{ intentId: string; status?: string; txHash?: string }> {
  const res = await swapFetch(apiUrl, "/swap/submit", {
    intentId,
    signature,
    ...metadata,
  });
  const json = (await res.json()) as { error?: string; intentId?: string; status?: string; txHash?: string };
  if (!res.ok) {
    throw new SwapApiError(json.error ?? `Submit failed (${res.status})`, undefined, res.status);
  }
  return {
    intentId: json.intentId ?? intentId,
    status: json.status,
    txHash: json.txHash,
  };
}
