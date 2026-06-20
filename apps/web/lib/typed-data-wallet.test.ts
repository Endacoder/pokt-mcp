import { describe, expect, it } from "vitest";
import { normalizeTypedDataForWallet } from "./typed-data-wallet";

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
});
