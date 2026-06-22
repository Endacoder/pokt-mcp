import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SwapApiError } from "./swap-api";
import {
  assertPermit2SignatureMatchesWallet,
  resolveOrderAccountFromPayload,
  type TypedDataPayload,
} from "./swap-sign";
import { prepareTypedDataForWallet, type WalletTypedDataPayload } from "./typed-data-wallet";

const WALLET_A = "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f";
const WALLET_B = "0xeb66942c7849905b7937ccd2BCa3B1B6e30E5533";

const WITNESS_PAYLOAD: TypedDataPayload = {
  domain: {
    name: "Permit2",
    chainId: 1,
    verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
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
      swapper: WALLET_A,
      nonce: "1",
      deadline: "9999999999",
    },
  },
};

describe("resolveOrderAccountFromPayload", () => {
  it("returns witness.swapper when it matches the connected wallet", () => {
    expect(resolveOrderAccountFromPayload(WITNESS_PAYLOAD, WALLET_A)).toBe(getAddress(WALLET_A));
  });

  it("throws WALLET_ACCOUNT_MISMATCH when witness.swapper differs from connected wallet", () => {
    expect(() => resolveOrderAccountFromPayload(WITNESS_PAYLOAD, WALLET_B)).toThrow(SwapApiError);
    try {
      resolveOrderAccountFromPayload(WITNESS_PAYLOAD, WALLET_B);
    } catch (err) {
      expect(err).toBeInstanceOf(SwapApiError);
      expect((err as SwapApiError).code).toBe("WALLET_ACCOUNT_MISMATCH");
      expect((err as SwapApiError).message).toMatch(/swap order account/i);
    }
  });

  it("reads witness.info.swapper when present", () => {
    const payload: TypedDataPayload = {
      ...WITNESS_PAYLOAD,
      message: {
        ...WITNESS_PAYLOAD.message,
        witness: {
          info: { swapper: WALLET_A },
        },
      },
    };
    expect(resolveOrderAccountFromPayload(payload, WALLET_A)).toBe(getAddress(WALLET_A));
  });
});

const TEST_PRIVATE_KEY =
  "0x0a9337dc6a1e2f51420f02845265e0d51dd6d056099274682e276fc4cd76a575" as const;
const TEST_ACCOUNT_ADDRESS = "0x64E014861Cd843000d78498918669303E1b53849" as const;

describe("assertPermit2SignatureMatchesWallet", () => {
  const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

  it("recovers the signer and matches the live wallet", async () => {
    const payloadForSigner: TypedDataPayload = {
      ...WITNESS_PAYLOAD,
      message: {
        ...WITNESS_PAYLOAD.message,
        witness: {
          ...(WITNESS_PAYLOAD.message.witness as Record<string, unknown>),
          swapper: testAccount.address,
        },
      },
    };
    const typedData = prepareTypedDataForWallet(payloadForSigner as WalletTypedDataPayload);

    const signature = await testAccount.signTypedData({
      domain: typedData.domain as {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: typedData.types as Record<string, { name: string; type: string }[]>,
      primaryType: typedData.primaryType,
      message: typedData.message as Record<string, unknown>,
    });

    const recovered = await assertPermit2SignatureMatchesWallet(
      payloadForSigner,
      signature,
      testAccount.address,
    );
    expect(recovered).toBe(TEST_ACCOUNT_ADDRESS);
  });

  it("throws WALLET_ACCOUNT_MISMATCH when live wallet differs from recovered signer", async () => {
    const payloadForSigner: TypedDataPayload = {
      ...WITNESS_PAYLOAD,
      message: {
        ...WITNESS_PAYLOAD.message,
        witness: {
          ...(WITNESS_PAYLOAD.message.witness as Record<string, unknown>),
          swapper: testAccount.address,
        },
      },
    };
    const typedData = prepareTypedDataForWallet(payloadForSigner as WalletTypedDataPayload);

    const signature = await testAccount.signTypedData({
      domain: typedData.domain as {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: typedData.types as Record<string, { name: string; type: string }[]>,
      primaryType: typedData.primaryType,
      message: typedData.message as Record<string, unknown>,
    });

    await expect(
      assertPermit2SignatureMatchesWallet(payloadForSigner, signature, WALLET_B),
    ).rejects.toThrow(/Connect Wallet/i);
  });
});
