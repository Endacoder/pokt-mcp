import type { SigningInstructions } from "./swap-api";
import { normalizeTypedDataForWallet, type WalletTypedDataPayload } from "./typed-data-wallet";

type ExpectedPermit = {
  tokenAddress: string;
  amountAtomic: string;
};

type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
};

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

function validatePermitAgainstQuote(
  instructions: SigningInstructions,
  expected: ExpectedPermit,
): void {
  const payloads = signingPayloadsFromInstructions(instructions);
  const permits = extractPermitTransferAmounts(payloads);
  if (permits.length === 0) return;

  const expectedToken = expected.tokenAddress.toLowerCase();
  const expectedAmount = BigInt(expected.amountAtomic);

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
  return out;
}

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

function walletTypedDataPayload(payload: TypedDataPayload): WalletTypedDataPayload {
  return normalizeTypedDataForWallet(payload as WalletTypedDataPayload);
}

async function signTypedDataPayload(
  provider: NonNullable<Window["ethereum"]>,
  address: string,
  payload: TypedDataPayload,
): Promise<string> {
  const typedData = walletTypedDataPayload(payload);
  try {
    return (await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, typedData],
    })) as string;
  } catch (err) {
    if (!isWalletInvalidInputError(err)) throw err;
    return (await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(typedData)],
    })) as string;
  }
}

async function signStep(
  provider: NonNullable<Window["ethereum"]>,
  address: string,
  step: SigningInstructions,
): Promise<string> {
  const method = (step.method ?? step.type ?? "").toLowerCase();

  if (method.includes("typed") || step.typedData || step.eip712 || step.domain) {
    return signTypedDataPayload(provider, address, buildTypedDataPayload(step));
  }

  const tx = (step.transaction ?? step.tx) as Record<string, unknown> | undefined;
  if (method.includes("transaction") || method === "eth_sendtransaction" || tx) {
    if (!tx) throw new Error("Transaction signing requested but no transaction payload");
    return (await provider.request({
      method: "eth_sendTransaction",
      params: [normalizeTx(tx, address)],
    })) as string;
  }

  const message = step.personalMessage ?? (typeof step.message === "string" ? step.message : undefined);
  if (method.includes("personal") || message) {
    if (!message) throw new Error("Personal sign requested but no message");
    return (await provider.request({
      method: "personal_sign",
      params: [message, address],
    })) as string;
  }

  if (Array.isArray(step.params) && step.params.length > 0 && step.method) {
    return (await provider.request({
      method: step.method,
      params: step.params,
    })) as string;
  }

  throw new Error("Unsupported signing step from Intent MCP");
}

function isWalletInvalidInputError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return code === -32000 || /invalid input/i.test(message);
}

/** Sign swap intent in the connected wallet; may require multiple EIP-712 payloads. */
export async function signSwapInstructions(
  instructions: SigningInstructions,
  walletAddress: string,
  expectedPermit?: ExpectedPermit,
): Promise<string> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No wallet provider — connect your wallet first");

  const payloads = signingPayloadsFromInstructions(instructions);
  if (payloads.length > 0) {
    if (expectedPermit) {
      validatePermitAgainstQuote(instructions, expectedPermit);
    }
    let lastSignature = "";
    try {
      for (const payload of payloads) {
        lastSignature = await signTypedDataPayload(provider, walletAddress, payload);
      }
    } catch (err) {
      if (isWalletInvalidInputError(err)) {
        throw new Error(
          "Wallet rejected the signing payload (Invalid input). Request a fresh quote and try again, or use a different wallet.",
        );
      }
      throw err;
    }
    return lastSignature;
  }

  if (Array.isArray(instructions.steps)) {
    const walletSteps = instructions.steps.filter(
      (step): step is SigningInstructions => typeof step === "object" && step !== null,
    );
    if (walletSteps.length > 0) {
      let lastSignature = "";
      for (const step of walletSteps) {
        lastSignature = await signStep(provider, walletAddress, step);
      }
      return lastSignature;
    }
  }

  return signStep(provider, walletAddress, instructions);
}

export { isWalletInvalidInputError };
