import { getAddress } from "viem";

type Eip712Field = { name: string; type: string };

export type WalletTypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, Eip712Field[]>;
  message: Record<string, unknown>;
  primaryType: string;
};

const UINT_TYPES = new Set(["uint256", "uint128", "uint64", "uint32", "uint8", "uint160", "uint48"]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isBlank(value: unknown): boolean {
  return value == null || value === "";
}

function checksumAddress(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return value;
  }
}

function normalizeScalar(value: unknown, type: string): unknown {
  if (type === "uint48" || type === "uint32" || type === "uint8") {
    return typeof value === "number" ? value : Number(value);
  }
  if (UINT_TYPES.has(type)) {
    return typeof value === "bigint" ? value.toString() : String(value);
  }
  if (type === "bool") return Boolean(value);
  if (type === "address" && typeof value === "string") return checksumAddress(value);
  if (type === "bytes" || type === "bytes32") return String(value);
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) return [];
    const itemType = type.slice(0, -2);
    return value.map((item) => normalizeScalar(item, itemType));
  }
  return value;
}

function normalizeMessage(
  types: Record<string, Eip712Field[]>,
  primaryType: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const fields = types[primaryType];
  if (!fields) return message;

  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = message[field.name];
    if (raw === undefined || raw === null) {
      if (field.type === "address") {
        throw new Error(
          `EIP-712 field "${field.name}" (address) is missing from the signing payload. Request a fresh swap quote.`,
        );
      }
      continue;
    }

    if (types[field.type]) {
      out[field.name] = normalizeMessage(types, field.type, raw as Record<string, unknown>);
    } else {
      out[field.name] = normalizeScalar(raw, field.type);
    }
  }
  return out;
}

/** UniswapX witness orders often omit info.reactor; Permit2 spender is the reactor contract. */
function enrichOrderInfoInWitness(
  witness: Record<string, unknown>,
  types: Record<string, Eip712Field[]>,
  reactorFallback?: string,
): Record<string, unknown> {
  const orderInfoFields = types.OrderInfo;
  if (!orderInfoFields) return witness;

  const infoRaw =
    witness.info && typeof witness.info === "object"
      ? { ...(witness.info as Record<string, unknown>) }
      : {};

  for (const field of orderInfoFields) {
    if (isBlank(infoRaw[field.name]) && !isBlank(witness[field.name])) {
      infoRaw[field.name] = witness[field.name];
    }
  }

  if (isBlank(infoRaw.reactor) && reactorFallback && ADDRESS_RE.test(reactorFallback)) {
    infoRaw.reactor = reactorFallback;
  }

  if (isBlank(infoRaw.additionalValidationContract)) {
    infoRaw.additionalValidationContract = ZERO_ADDRESS;
  }
  if (isBlank(infoRaw.additionalValidationData)) {
    infoRaw.additionalValidationData = "0x";
  }

  return { ...witness, info: infoRaw };
}

function enrichWitnessMessage(
  message: Record<string, unknown>,
  types: Record<string, Eip712Field[]>,
): Record<string, unknown> {
  const witness = message.witness;
  if (!witness || typeof witness !== "object") return message;

  const reactorFallback = typeof message.spender === "string" ? message.spender : undefined;
  return {
    ...message,
    witness: enrichOrderInfoInWitness(witness as Record<string, unknown>, types, reactorFallback),
  };
}

function collectMissingAddressFields(
  types: Record<string, Eip712Field[]>,
  primaryType: string,
  message: Record<string, unknown>,
  path = primaryType,
): string[] {
  const fields = types[primaryType];
  if (!fields) return [];

  const missing: string[] = [];
  for (const field of fields) {
    const raw = message[field.name];
    const fieldPath = `${path}.${field.name}`;

    if (field.type === "address") {
      if (isBlank(raw) || (typeof raw === "string" && !ADDRESS_RE.test(raw))) {
        missing.push(fieldPath);
      }
      continue;
    }

    if (types[field.type]) {
      if (raw && typeof raw === "object") {
        missing.push(
          ...collectMissingAddressFields(types, field.type, raw as Record<string, unknown>, fieldPath),
        );
      } else {
        missing.push(...collectMissingAddressFields(types, field.type, {}, fieldPath));
      }
    }
  }
  return missing;
}

/** Intent MCP returns complete EIP-712 for these — do not reshape message fields. */
export function isPrebuiltOrderPayload(payload: WalletTypedDataPayload): boolean {
  const name = payload.domain?.name;
  if (typeof name !== "string") return false;
  return name === "1inch Aggregation Router" || name.startsWith("Gnosis Protocol");
}

/** Classic Uniswap Permit2 PermitSingle — preserve quote values exactly for /swap verification. */
export function isPermit2PermitSinglePayload(payload: WalletTypedDataPayload): boolean {
  if (payload.domain?.name !== "Permit2") return false;
  const types = payload.types ?? {};
  return Boolean(types.PermitSingle) && !types.PermitWitnessTransferFrom;
}

/** Any Permit2 EIP-712 payload — must be signed byte-for-byte (Intent MCP / Uniswap verify exact values). */
export function isPermit2Payload(payload: WalletTypedDataPayload): boolean {
  return payload.domain?.name === "Permit2";
}

/** Strip EIP712Domain only; preserve message bytes for relayer verification. */
export function minimalTypedDataForWallet(payload: WalletTypedDataPayload): WalletTypedDataPayload {
  const types = { ...payload.types };
  delete types.EIP712Domain;

  const domain = { ...payload.domain };
  if (domain.chainId != null) {
    domain.chainId = typeof domain.chainId === "string" ? Number(domain.chainId) : domain.chainId;
  }

  return {
    domain,
    types,
    primaryType: payload.primaryType,
    message: { ...payload.message },
  };
}

export function prepareTypedDataForWallet(payload: WalletTypedDataPayload): WalletTypedDataPayload {
  if (isPrebuiltOrderPayload(payload)) {
    return minimalTypedDataForWallet(payload);
  }
  // PermitSingle — preserve quote values byte-for-byte (Intent MCP / relayer verification).
  if (isPermit2PermitSinglePayload(payload)) {
    return minimalTypedDataForWallet(payload);
  }
  if (isPermit2Payload(payload)) {
    return minimalTypedDataForWallet(payload);
  }
  return normalizeTypedDataForWallet(payload);
}

/** Fail fast with a clear error before MetaMask rejects incomplete UniswapX witness data. */
export function validateTypedDataForWallet(payload: WalletTypedDataPayload): void {
  if (isPrebuiltOrderPayload(payload) || isPermit2Payload(payload)) return;
  const types = { ...payload.types };
  delete types.EIP712Domain;

  let primaryType = payload.primaryType;
  for (const preferred of [
    "PermitWitnessTransferFrom",
    "PermitTransferFrom",
    "PermitSingle",
    "Order",
  ]) {
    if (types[preferred]) {
      primaryType = preferred;
      break;
    }
  }

  const enriched = enrichWitnessMessage(payload.message, types);
  const missing = collectMissingAddressFields(types, primaryType, enriched);
  if (missing.length === 0) return;

  const reactorMissing = missing.some((field) => field.endsWith(".reactor") || field === "reactor");
  if (reactorMissing) {
    throw new Error(
      "Swap signing data is incomplete (missing reactor address in the UniswapX order). Request a fresh quote and try again.",
    );
  }

  throw new Error(
    `Swap signing data is incomplete (missing ${missing.slice(0, 3).join(", ")}). Request a fresh quote and try again.`,
  );
}

/** Shape typed data the way MetaMask / WalletConnect expect for eth_signTypedData_v4. */
export function normalizeTypedDataForWallet(payload: WalletTypedDataPayload): WalletTypedDataPayload {
  const types = { ...payload.types };
  delete types.EIP712Domain;

  let primaryType = payload.primaryType;
  for (const preferred of [
    "PermitWitnessTransferFrom",
    "PermitTransferFrom",
    "PermitSingle",
    "Order",
  ]) {
    if (types[preferred]) {
      primaryType = preferred;
      break;
    }
  }

  const domain = { ...payload.domain };
  if (domain.chainId != null) {
    domain.chainId = typeof domain.chainId === "string" ? Number(domain.chainId) : domain.chainId;
  }
  if (typeof domain.verifyingContract === "string") {
    domain.verifyingContract = checksumAddress(domain.verifyingContract);
  }

  const enrichedMessage = enrichWitnessMessage(payload.message, types);
  const message = normalizeMessage(types, primaryType, enrichedMessage);

  return {
    domain,
    types,
    primaryType,
    message,
  };
}
