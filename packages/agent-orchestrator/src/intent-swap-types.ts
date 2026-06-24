import { buildCowOrderTypedData } from "./intent-cow-order.js";
export {
  isUserPaidGasRequiredError,
  isUserPaidGasRoute,
  quoteRequiresGasAck,
  type GasRouteHint,
} from "@pokt-mcp/shared";

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
  /** Human-readable steps from Intent MCP (not wallet signing steps). */
  steps?: unknown;
  instructions?: Record<string, unknown>;
  messageToSign?: Record<string, unknown>;
  eip712Domain?: Record<string, unknown>;
  /** Normalized payloads ready for eth_signTypedData_v4, in signing order. */
  signingPayloads?: TypedDataPayload[];
  [key: string]: unknown;
};

export type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
};

export type ExpectedPermit = {
  tokenAddress: string;
  amountAtomic: string;
};

export type ExpectedSwapQuote = {
  tokenInAddress: string;
  tokenOutAddress: string;
  amountInAtomic: string;
  chainId: number;
};

export class PermitAmountMismatchError extends Error {
  readonly code = "PERMIT_AMOUNT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "PermitAmountMismatchError";
  }
}

export class OrderQuoteMismatchError extends Error {
  readonly code = "ORDER_QUOTE_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "OrderQuoteMismatchError";
  }
}

export function extractPermitTransferAmounts(
  payloads: TypedDataPayload[],
): Array<{ token: string; amount: string }> {
  const out: Array<{ token: string; amount: string }> = [];
  for (const payload of payloads) {
    if (
      payload.primaryType !== "PermitTransferFrom" &&
      payload.primaryType !== "PermitWitnessTransferFrom"
    ) {
      continue;
    }
    const permitted = payload.message.permitted;
    if (!permitted || typeof permitted !== "object") continue;
    const token = (permitted as Record<string, unknown>).token;
    const amount = (permitted as Record<string, unknown>).amount;
    if (typeof token === "string" && amount != null) {
      out.push({ token, amount: String(amount) });
    }
  }
  return out;
}

/** Reject wallet prompts where Permit2 spending cap exceeds the quoted swap input. */
export function validatePermitAgainstQuote(
  instructions: SigningInstructions,
  expected: ExpectedPermit,
): void {
  const payloads =
    instructions.signingPayloads && instructions.signingPayloads.length > 0
      ? instructions.signingPayloads
      : extractSigningPayloads(instructions);
  const permits = extractPermitTransferAmounts(payloads);
  if (permits.length === 0) return;

  const expectedToken = expected.tokenAddress.toLowerCase();
  let expectedAmount: bigint;
  try {
    expectedAmount = BigInt(expected.amountAtomic);
  } catch {
    throw new PermitAmountMismatchError("Invalid expected swap amount for permit validation.");
  }

  for (const permit of permits) {
    if (permit.token.toLowerCase() !== expectedToken) continue;

    let permitAmount: bigint;
    try {
      permitAmount = BigInt(permit.amount);
    } catch {
      throw new PermitAmountMismatchError(
        "Wallet permit contains a non-numeric amount. Do not sign — request a new quote.",
      );
    }

    if (permitAmount !== expectedAmount) {
      throw new PermitAmountMismatchError(
        `Wallet permit requests ${permitAmount.toString()} atomic units but this quote is for ${expectedAmount.toString()}. ` +
          "Do not sign — request a fresh swap quote. (Incorrect token decimals in the quote often cause this.)",
      );
    }
  }
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function chainIdFromDomain(domain: Record<string, unknown>): number | undefined {
  const raw = domain.chainId;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Reject wallet prompts where gasless Order fields diverge from the quoted swap. */
export function validateOrderAgainstQuote(
  instructions: SigningInstructions,
  expected: ExpectedSwapQuote,
): void {
  const payloads =
    instructions.signingPayloads && instructions.signingPayloads.length > 0
      ? instructions.signingPayloads
      : extractSigningPayloads(instructions);

  let expectedAmount: bigint;
  try {
    expectedAmount = BigInt(expected.amountInAtomic);
  } catch {
    throw new OrderQuoteMismatchError("Invalid expected swap amount for order validation.");
  }

  const tokenIn = normalizeAddress(expected.tokenInAddress);
  const tokenOut = normalizeAddress(expected.tokenOutAddress);

  for (const payload of payloads) {
    if (payload.primaryType !== "Order") continue;

    const domainChainId = chainIdFromDomain(payload.domain);
    if (domainChainId != null && domainChainId !== expected.chainId) {
      throw new OrderQuoteMismatchError(
        `Order chainId ${domainChainId} does not match this quote (chain ${expected.chainId}). Request a fresh quote.`,
      );
    }

    const message = payload.message;
    const makerAsset = typeof message.makerAsset === "string" ? message.makerAsset : undefined;
    const takerAsset = typeof message.takerAsset === "string" ? message.takerAsset : undefined;
    const makingAmount = message.makingAmount;
    const sellToken = typeof message.sellToken === "string" ? message.sellToken : undefined;
    const buyToken = typeof message.buyToken === "string" ? message.buyToken : undefined;
    const sellAmount = message.sellAmount;

    if (makerAsset != null) {
      if (normalizeAddress(makerAsset) !== tokenIn) {
        throw new OrderQuoteMismatchError(
          `Order makerAsset ${makerAsset} does not match quoted input token ${expected.tokenInAddress}.`,
        );
      }
      if (takerAsset != null && normalizeAddress(takerAsset) !== tokenOut) {
        throw new OrderQuoteMismatchError(
          `Order takerAsset ${takerAsset} does not match quoted output token ${expected.tokenOutAddress}.`,
        );
      }
      if (makingAmount != null && BigInt(String(makingAmount)) !== expectedAmount) {
        throw new OrderQuoteMismatchError(
          `Order makingAmount (${String(makingAmount)}) does not match quoted input (${expected.amountInAtomic}). Do not sign.`,
        );
      }
      continue;
    }

    if (sellToken != null) {
      if (normalizeAddress(sellToken) !== tokenIn) {
        throw new OrderQuoteMismatchError(
          `Order sellToken ${sellToken} does not match quoted input token ${expected.tokenInAddress}.`,
        );
      }
      if (buyToken != null && normalizeAddress(buyToken) !== tokenOut) {
        throw new OrderQuoteMismatchError(
          `Order buyToken ${buyToken} does not match quoted output token ${expected.tokenOutAddress}.`,
        );
      }
      if (sellAmount != null && BigInt(String(sellAmount)) !== expectedAmount) {
        throw new OrderQuoteMismatchError(
          `Order sellAmount (${String(sellAmount)}) does not match quoted input (${expected.amountInAtomic}). Do not sign.`,
        );
      }
    }
  }
}

export function validateSwapQuoteAgainstInstructions(
  instructions: SigningInstructions,
  expected: ExpectedSwapQuote,
): void {
  validatePermitAgainstQuote(instructions, {
    tokenAddress: expected.tokenInAddress,
    amountAtomic: expected.amountInAtomic,
  });
  validateOrderAgainstQuote(instructions, expected);
}

export type PrepareIntentResponse = {
  intentId?: string;
  intent?: { intentId?: string; id?: string; signingInstructions?: unknown };
  signingInstructions?: SigningInstructions | string;
  instructions?: SigningInstructions;
  [key: string]: unknown;
};

export type SubmitIntentResponse = {
  intentId?: string;
  status?: string;
  txHash?: string;
  transactionHash?: string;
  orderHash?: string;
  nextUnsignedIntent?: unknown;
  [key: string]: unknown;
};

export function extractIntentId(data: PrepareIntentResponse): string {
  const intent = data.intent;
  const id = data.intentId ?? intent?.intentId ?? intent?.id;
  if (typeof id === "string" && id.length > 0) return id;
  throw new Error("Intent MCP prepare_intent did not return an intentId");
}

function isTypedDataPayload(value: unknown): value is TypedDataPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.primaryType === "string" &&
    v.primaryType.length > 0 &&
    typeof v.domain === "object" &&
    v.domain !== null &&
    typeof v.types === "object" &&
    v.types !== null &&
    typeof v.message === "object" &&
    v.message !== null
  );
}

function typedDataFromParts(
  domain: Record<string, unknown>,
  types: Record<string, unknown>,
  message: Record<string, unknown>,
  primaryType: string,
): TypedDataPayload {
  return { domain, types, message, primaryType };
}

function fromEip712Block(block: unknown): TypedDataPayload | undefined {
  if (!block || typeof block !== "object") return undefined;
  const eip = block as Record<string, unknown>;
  if (!isTypedDataPayload(eip)) return undefined;
  return eip;
}

function fromCowOrderBlock(block: Record<string, unknown>): TypedDataPayload | undefined {
  return buildCowOrderTypedData(block);
}

function fromMessageToSign(
  messageToSign: unknown,
  context?: Record<string, unknown>,
): TypedDataPayload | undefined {
  if (!messageToSign || typeof messageToSign !== "object") return undefined;
  const msg = messageToSign as Record<string, unknown>;
  if (msg.domain && msg.types && msg.message && typeof msg.primaryType === "string") {
    return typedDataFromParts(
      msg.domain as Record<string, unknown>,
      msg.types as Record<string, unknown>,
      msg.message as Record<string, unknown>,
      msg.primaryType,
    );
  }
  if (msg.order && context) {
    return fromCowOrderBlock({ ...context, messageToSign: msg });
  }
  return fromEip712Block(msg.eip712);
}

/** Collect EIP-712 payloads from Intent MCP signing instruction shapes. */
export function extractSigningPayloads(raw: SigningInstructions): TypedDataPayload[] {
  const payloads: TypedDataPayload[] = [];
  const seen = new Set<string>();

  function add(payload: TypedDataPayload | undefined): void {
    if (!payload) return;
    const key = JSON.stringify(payload);
    if (seen.has(key)) return;
    seen.add(key);
    payloads.push(payload);
  }

  function scan(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const obj = value as SigningInstructions;

    add(fromEip712Block(obj.typedData));
    add(fromEip712Block(obj.eip712));

    if (obj.domain && obj.types && obj.message && typeof obj.primaryType === "string") {
      add(
        typedDataFromParts(
          obj.domain as Record<string, unknown>,
          obj.types as Record<string, unknown>,
          obj.message as Record<string, unknown>,
          obj.primaryType,
        ),
      );
    }

    const messageToSign = obj.messageToSign;
    if (messageToSign && typeof messageToSign === "object") {
      add(fromMessageToSign(messageToSign, obj));
    }

    add(fromCowOrderBlock(obj));

    const instructions = obj.instructions;
    if (instructions && typeof instructions === "object") {
      add(fromCowOrderBlock(instructions as Record<string, unknown>));
      scan(instructions);
      const instrMsg = instructions.messageToSign;
      if (instrMsg && typeof instrMsg === "object") {
        add(fromMessageToSign(instrMsg, instructions as Record<string, unknown>));
      }
    }
  }

  scan(raw);

  const direct = raw.signingPayloads;
  if (Array.isArray(direct)) {
    for (const item of direct) {
      add(isTypedDataPayload(item) ? item : fromEip712Block(item));
    }
  }

  return payloads;
}

export function normalizeSigningInstructions(
  prepare: PrepareIntentResponse,
  fetched?: SigningInstructions,
): SigningInstructions {
  const merged: SigningInstructions = {
    ...(typeof prepare === "object" ? prepare : {}),
    ...(fetched ?? {}),
  };

  if (fetched?.instructions && typeof fetched.instructions === "object") {
    Object.assign(merged, fetched.instructions);
    merged.instructions = fetched.instructions;
  }

  const payloads = extractSigningPayloads(merged);
  if (payloads.length > 0) {
    merged.signingPayloads = payloads;
    const first = payloads[0];
    merged.domain = first.domain;
    merged.types = first.types;
    merged.message = first.message;
    merged.primaryType = first.primaryType;
    merged.typedData = first;
    return merged;
  }

  const directPayloads = merged.signingPayloads;
  if (Array.isArray(directPayloads) && directPayloads.length > 0 && isTypedDataPayload(directPayloads[0])) {
    const first = directPayloads[0] as TypedDataPayload;
    merged.domain = first.domain;
    merged.types = first.types;
    merged.message = first.message;
    merged.primaryType = first.primaryType;
    merged.typedData = first;
    return merged;
  }

  if (merged.transaction || merged.tx || merged.method) {
    return merged;
  }

  throw new Error(
    "SIGNING_PAYLOAD_UNAVAILABLE: Intent MCP did not return wallet signing data. Request a new swap quote and try again.",
  );
}

export function isConfirmationRequiredError(message: string): boolean {
  return /CONFIRMATION_REQUIRED|Wallet confirmation signature required/i.test(message);
}

export function isQuoteExpiredError(message: string): boolean {
  return /^quote\s+q_|QUOTE_EXPIRED|has expired\. request a new quote/i.test(message);
}

export function isRouteBuildError(message: string): boolean {
  return /swap build failed|RequestValidationError|does not match any of the allowed types/i.test(
    message,
  );
}

export function isSigningPayloadUnavailableError(message: string): boolean {
  return /SIGNING_PAYLOAD_UNAVAILABLE/i.test(message);
}

/** 1inch Fusion on Ethereum mainnet — Intent MCP omits feeReceiver when platform fee is set. */
export function isOneinchOrderBuildError(message: string): boolean {
  return /FEE_RECEIVER_REQUIRED|feeReceiver is required/i.test(message);
}

export function isOrderBuildError(message: string): boolean {
  return /Order build failed/i.test(message) || isOneinchOrderBuildError(message);
}

export function isInsufficientAllowanceError(message: string): boolean {
  return /Insufficient allowance|InputValidationError.*allowance/i.test(message);
}

/** Gas-route simulation before Permit2 approval — router transferFrom reverts. */
export function isSimulationTransferFailedError(message: string): boolean {
  return /TRANSFER_FROM_FAILED|transfer.?from.?failed/i.test(message);
}

export type SwapRequoteParams = {
  fromChain: number;
  toChain: number;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps?: number;
  executionMode?: "any" | "gasless";
};

/** Mainnet gasless fills rarely succeed under ~$20 — prefer best-price routing. */
export function applyMainnetSmallSwapGasMode(requote?: SwapRequoteParams): SwapRequoteParams | undefined {
  if (!requote || requote.fromChain !== 1) return requote;
  try {
    if (BigInt(requote.amount) < 20_000_000n && requote.executionMode === "gasless") {
      return { ...requote, executionMode: "any" };
    }
  } catch {
    /* ignore invalid amount */
  }
  return requote;
}

export function isInvalidExecutionModeError(message: string): boolean {
  return /INVALID_EXECUTION_MODE/i.test(message);
}
