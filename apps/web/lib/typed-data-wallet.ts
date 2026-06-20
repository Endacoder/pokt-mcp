import { getAddress } from "viem";

type Eip712Field = { name: string; type: string };

export type WalletTypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, Eip712Field[]>;
  message: Record<string, unknown>;
  primaryType: string;
};

const UINT_TYPES = new Set(["uint256", "uint128", "uint64", "uint32", "uint8"]);

function checksumAddress(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return value;
  }
}

function normalizeScalar(value: unknown, type: string): unknown {
  if (UINT_TYPES.has(type)) {
    if (type === "uint32" || type === "uint8") {
      return typeof value === "number" ? value : Number(value);
    }
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
    if (raw === undefined || raw === null) continue;

    if (types[field.type]) {
      out[field.name] = normalizeMessage(types, field.type, raw as Record<string, unknown>);
    } else {
      out[field.name] = normalizeScalar(raw, field.type);
    }
  }
  return out;
}

/** Shape typed data the way MetaMask / WalletConnect expect for eth_signTypedData_v4. */
export function normalizeTypedDataForWallet(payload: WalletTypedDataPayload): WalletTypedDataPayload {
  const types = { ...payload.types };
  delete types.EIP712Domain;

  const domain = { ...payload.domain };
  if (domain.chainId != null) {
    domain.chainId = typeof domain.chainId === "string" ? Number(domain.chainId) : domain.chainId;
  }
  if (typeof domain.verifyingContract === "string") {
    domain.verifyingContract = checksumAddress(domain.verifyingContract);
  }

  const message = normalizeMessage(types, payload.primaryType, payload.message);

  return {
    domain,
    types,
    primaryType: payload.primaryType,
    message,
  };
}
