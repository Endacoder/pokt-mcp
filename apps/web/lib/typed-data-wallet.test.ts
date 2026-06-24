import { describe, expect, it } from "vitest";
import {
  isPrebuiltOrderPayload,
  minimalTypedDataForWallet,
  prepareTypedDataForWallet,
  normalizeTypedDataForWallet,
  validateTypedDataForWallet,
  isPermit2PermitSinglePayload,
} from "./typed-data-wallet";

const ORDER_INFO_TYPES = {
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" },
  ],
  ExclusiveDutchOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "decayStartTime", type: "uint256" },
    { name: "inputToken", type: "address" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "ExclusiveDutchOrder" },
  ],
};

describe("normalizeTypedDataForWallet", () => {
  it("removes EIP712Domain and orders PermitWitnessTransferFrom fields", () => {
    const normalized = normalizeTypedDataForWallet({
      domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "PermitWitnessTransferFrom",
      message: {
        nonce: "123",
        spender: "0xabc",
        deadline: "999",
        permitted: { token: "0xtoken", amount: "1000000" },
      },
    });

    expect(normalized.types.EIP712Domain).toBeUndefined();
    expect(Object.keys(normalized.message)).toEqual(["permitted", "spender", "nonce", "deadline"]);
    expect(normalized.message.nonce).toBe("123");
  });

  it("normalizes CoW Order uint fields", () => {
    const normalized = normalizeTypedDataForWallet({
      domain: { name: "Gnosis Protocol", version: "1", chainId: 1, verifyingContract: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" },
      types: {
        Order: [
          { name: "sellAmount", type: "uint256" },
          { name: "validTo", type: "uint32" },
        ],
      },
      primaryType: "Order",
      message: { sellAmount: 921804, validTo: "1781947939" },
    });

    expect(normalized.message.sellAmount).toBe("921804");
    expect(normalized.message.validTo).toBe(1781947939);
  });

  it("preserves nested witness reactor for PermitWitnessTransferFrom", () => {
    const normalized = normalizeTypedDataForWallet({
      domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
      types: {
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        ExclusiveDutchOrder: [
          { name: "reactor", type: "address" },
          { name: "swapper", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "ExclusiveDutchOrder" },
        ],
      },
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: "0xdac17f958d2ee523a2206206994597c13d831ec7", amount: "1000000" },
        spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
        nonce: "1",
        deadline: "9999999999",
        witness: {
          reactor: "0x0000000000000000000000000000000000000001",
          swapper: "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f",
          nonce: "1",
          deadline: "9999999999",
        },
      },
    });

    const witness = normalized.message.witness as Record<string, unknown>;
    expect(witness.reactor).toBe("0x0000000000000000000000000000000000000001");
  });

  it("checksums address fields for MetaMask EIP-712 validation", () => {
    const normalized = normalizeTypedDataForWallet({
      domain: {
        name: "Gnosis Protocol",
        version: "v2",
        chainId: 1,
        verifyingContract: "0x9008D19f58AAfD9eD0D60971565AA8510560ab41",
      },
      types: {
        Order: [
          { name: "sellToken", type: "address" },
          { name: "receiver", type: "address" },
        ],
      },
      primaryType: "Order",
      message: {
        sellToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        receiver: "0x1111111111111111111111111111111111111111",
      },
    });

    expect(normalized.domain.verifyingContract).toBe("0x9008D19f58AAfd9ED0d60971565aa8510560aB41");
    expect(normalized.message.sellToken).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
  });

  it("fills witness.info.reactor from Permit2 spender for UniswapX orders", () => {
    const reactor = "0x0000000015757c461808EA25Eb309638B62681cf";
    const normalized = normalizeTypedDataForWallet({
      domain: {
        name: "Permit2",
        chainId: 1,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: ORDER_INFO_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "1000000" },
        spender: reactor,
        nonce: "1",
        deadline: "9999999999",
        witness: {
          info: {
            swapper: "0x1111111111111111111111111111111111111111",
            nonce: "1",
            deadline: "9999999999",
          },
          decayStartTime: "100",
          inputToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        },
      },
    });

    const witness = normalized.message.witness as Record<string, unknown>;
    const info = witness.info as Record<string, unknown>;
    expect(info.reactor).toBe(reactor);
    expect(info.additionalValidationContract).toBe("0x0000000000000000000000000000000000000000");
    expect(info.additionalValidationData).toBe("0x");
  });

  it("promotes flat witness.reactor into witness.info.reactor", () => {
    const reactor = "0x000000005aF66799D1a6317714D66800f9CA1406";
    const normalized = normalizeTypedDataForWallet({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: ORDER_INFO_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "1000000" },
        spender: reactor,
        nonce: "2",
        deadline: "9999999999",
        witness: {
          reactor,
          swapper: "0x2222222222222222222222222222222222222222",
          nonce: "2",
          deadline: "9999999999",
          decayStartTime: "100",
          inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
    });

    const info = (normalized.message.witness as Record<string, unknown>).info as Record<string, unknown>;
    expect(info.reactor).toBe(reactor);
    expect(info.swapper).toBe("0x2222222222222222222222222222222222222222");
  });
});

describe("validateTypedDataForWallet", () => {
  it("passes when reactor is inferred from Permit2 spender", () => {
    expect(() =>
      validateTypedDataForWallet({
        domain: { name: "Permit2", chainId: 1 },
        types: ORDER_INFO_TYPES,
        primaryType: "PermitWitnessTransferFrom",
        message: {
          permitted: { token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "1000000" },
          spender: "0x0000000015757c461808EA25Eb309638B62681cf",
          nonce: "1",
          deadline: "9999999999",
          witness: {
            info: {
              swapper: "0x1111111111111111111111111111111111111111",
              nonce: "1",
              deadline: "9999999999",
            },
            decayStartTime: "100",
            inputToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          },
        },
      }),
    ).not.toThrow();
  });

  it("preserves Permit2 PermitWitnessTransferFrom message without reshaping witness", () => {
    const payload = {
      domain: {
        name: "Permit2",
        chainId: 1,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: ORDER_INFO_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "1000000" },
        spender: "0x0000000015757c461808EA25Eb309638B62681cf",
        nonce: "1",
        deadline: "9999999999",
        witness: {
          info: {
            swapper: "0x1111111111111111111111111111111111111111",
            nonce: "1",
            deadline: "9999999999",
          },
          decayStartTime: "100",
          inputToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        },
      },
    };
    expect(prepareTypedDataForWallet(payload).message).toEqual(payload.message);
  });

  it("preserves Permit2 PermitSingle quote values without reshaping fields", () => {
    const payload = {
      domain: {
        name: "Permit2",
        chainId: 1,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: {
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
        PermitSingle: [
          { name: "details", type: "PermitDetails" },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          amount: "1461501637330902918203684832716283019655932542975",
          expiration: "1784615532",
          nonce: "0",
        },
        spender: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
        sigDeadline: "1782025354",
      },
    };
    expect(isPermit2PermitSinglePayload(payload)).toBe(true);
    const prepared = prepareTypedDataForWallet(payload);
    expect(prepared.message).toEqual(payload.message);
    expect(prepared.domain.chainId).toBe(1);
  });

  it("preserves 1inch Fusion order message without reshaping uint fields", () => {
    const payload = {
      domain: {
        name: "1inch Aggregation Router",
        version: "6",
        chainId: 1,
        verifyingContract: "0x111111125421ca6dc452d289314280a0f8842a65",
      },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }],
        Order: [
          { name: "salt", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "makingAmount", type: "uint256" },
        ],
      },
      primaryType: "Order",
      message: {
        salt: "13536346679004736730001175820964444431128115928525108270374711044564899764043",
        maker: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        makingAmount: "2000000",
      },
    };
    expect(isPrebuiltOrderPayload(payload)).toBe(true);
    expect(() => validateTypedDataForWallet(payload)).not.toThrow();
    const minimal = minimalTypedDataForWallet(payload);
    expect(minimal.types.EIP712Domain).toBeUndefined();
    expect(minimal.message.salt).toBe(payload.message.salt);
    expect(minimal.message.makingAmount).toBe("2000000");
    expect(prepareTypedDataForWallet(payload).message).toEqual(payload.message);
  });
});
