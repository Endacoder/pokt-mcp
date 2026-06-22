import type { SigningInstructions } from "./swap-api";

export type ExpectedSwapQuote = {
  tokenInAddress: string;
  tokenOutAddress: string;
  amountInAtomic: string;
  chainId: number;
};

type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
};

function signingPayloadsFromInstructions(instructions: SigningInstructions): TypedDataPayload[] {
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

function extractPermitTransferAmounts(
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
    const permitted = payload.message.permitted as { token?: string; amount?: unknown } | undefined;
    if (permitted?.token && permitted.amount != null) {
      out.push({ token: permitted.token, amount: String(permitted.amount) });
    }
  }
  return out;
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

export function validatePermitAgainstQuote(
  instructions: SigningInstructions,
  expected: Pick<ExpectedSwapQuote, "tokenInAddress" | "amountInAtomic">,
): void {
  const payloads = signingPayloadsFromInstructions(instructions);
  const permits = extractPermitTransferAmounts(payloads);
  if (permits.length === 0) return;

  const expectedToken = expected.tokenInAddress.toLowerCase();
  const expectedAmount = BigInt(expected.amountInAtomic);

  for (const permit of permits) {
    if (permit.token.toLowerCase() !== expectedToken) continue;
    const permitAmount = BigInt(permit.amount);
    if (permitAmount !== expectedAmount) {
      throw new Error(
        `Wallet permit amount (${permitAmount.toString()}) does not match this quote (${expectedAmount.toString()}). Do not sign — request a new quote.`,
      );
    }
  }
}

export function validateOrderAgainstQuote(
  instructions: SigningInstructions,
  expected: ExpectedSwapQuote,
): void {
  const payloads = signingPayloadsFromInstructions(instructions);
  const expectedAmount = BigInt(expected.amountInAtomic);
  const tokenIn = normalizeAddress(expected.tokenInAddress);
  const tokenOut = normalizeAddress(expected.tokenOutAddress);

  for (const payload of payloads) {
    if (payload.primaryType !== "Order") continue;

    const domainChainId = chainIdFromDomain(payload.domain);
    if (domainChainId != null && domainChainId !== expected.chainId) {
      throw new Error(
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
        throw new Error(
          `Order makerAsset ${makerAsset} does not match quoted input token ${expected.tokenInAddress}.`,
        );
      }
      if (takerAsset != null && normalizeAddress(takerAsset) !== tokenOut) {
        throw new Error(
          `Order takerAsset ${takerAsset} does not match quoted output token ${expected.tokenOutAddress}.`,
        );
      }
      if (makingAmount != null && BigInt(String(makingAmount)) !== expectedAmount) {
        throw new Error(
          `Order makingAmount (${String(makingAmount)}) does not match quoted input (${expected.amountInAtomic}). Do not sign.`,
        );
      }
      continue;
    }

    if (sellToken != null) {
      if (normalizeAddress(sellToken) !== tokenIn) {
        throw new Error(
          `Order sellToken ${sellToken} does not match quoted input token ${expected.tokenInAddress}.`,
        );
      }
      if (buyToken != null && normalizeAddress(buyToken) !== tokenOut) {
        throw new Error(
          `Order buyToken ${buyToken} does not match quoted output token ${expected.tokenOutAddress}.`,
        );
      }
      if (sellAmount != null && BigInt(String(sellAmount)) !== expectedAmount) {
        throw new Error(
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
  validatePermitAgainstQuote(instructions, expected);
  validateOrderAgainstQuote(instructions, expected);
}
