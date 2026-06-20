import type { TypedDataPayload } from "./intent-swap-types.js";

/** GPv2Settlement contracts — https://docs.cow.fi/cow-protocol/reference/contracts/core */
const COW_SETTLEMENT_BY_CHAIN: Record<number, string> = {
  1: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  100: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  42161: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  8453: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  11155111: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
};

const COW_ORDER_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Order: [
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "receiver", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "appData", type: "bytes32" },
    { name: "feeAmount", type: "uint256" },
    { name: "kind", type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance", type: "string" },
    { name: "buyTokenBalance", type: "string" },
  ],
};

function cowBalanceLabel(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && !/^\d+$/.test(value)) {
    return value;
  }
  return "erc20";
}

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  return String(value);
}

/** Build EIP-712 typed data for Intent MCP CoW / Gnosis Protocol order intents. */
export function buildCowOrderTypedData(block: Record<string, unknown>): TypedDataPayload | undefined {
  const messageToSign = block.messageToSign;
  const eip712Domain = block.eip712Domain;
  if (!messageToSign || typeof messageToSign !== "object") return undefined;
  if (!eip712Domain || typeof eip712Domain !== "object") return undefined;

  const envelope = messageToSign as Record<string, unknown>;
  const order = envelope.order;
  if (!order || typeof order !== "object") return undefined;
  if (envelope.signingScheme !== "eip712" && envelope.signingScheme !== undefined) return undefined;

  const o = order as Record<string, unknown>;
  const domainRaw = eip712Domain as Record<string, unknown>;
  const chainId = Number(envelope.chainId ?? domainRaw.chainId);
  if (!Number.isFinite(chainId)) return undefined;

  const verifyingContract =
    typeof domainRaw.verifyingContract === "string"
      ? domainRaw.verifyingContract
      : COW_SETTLEMENT_BY_CHAIN[chainId];
  if (!verifyingContract) return undefined;

  const sellToken = asString(o.sellToken);
  const buyToken = asString(o.buyToken);
  const receiver = asString(o.receiver);
  const sellAmount = asString(o.sellAmount);
  const buyAmount = asString(o.buyAmount);
  const appData = asString(o.appData);
  const feeAmount = asString(o.feeAmount);
  const kind = asString(o.kind);
  if (!sellToken || !buyToken || !receiver || !sellAmount || !buyAmount || !appData || !feeAmount || !kind) {
    return undefined;
  }

  const validTo = Number(o.validTo);
  if (!Number.isFinite(validTo)) return undefined;

  return {
    domain: {
      name: domainRaw.name ?? "Gnosis Protocol",
      version: String(domainRaw.version ?? "1"),
      chainId,
      verifyingContract,
    },
    types: {
      Order: COW_ORDER_TYPES.Order,
    },
    primaryType: "Order",
    message: {
      sellToken,
      buyToken,
      receiver,
      sellAmount,
      buyAmount,
      validTo,
      appData,
      feeAmount,
      kind,
      partiallyFillable: Boolean(o.partiallyFillable),
      sellTokenBalance: cowBalanceLabel(o.sellTokenBalance ?? o.sellTokenBalanceOffset),
      buyTokenBalance: cowBalanceLabel(o.buyTokenBalance ?? o.buyTokenBalanceOffset),
    },
  };
}
