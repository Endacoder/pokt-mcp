import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { PERMIT2_ADDRESS } from "./permit2-approval";
import { SwapApiError } from "./swap-api";
import { ephemeralTestAccount } from "./test-ephemeral-account";
import {
  assertPermit2SignatureMatchesWallet,
  recoverPermit2Signer,
  resolveOrderAccountFromPayload,
  resolvePermit2SubmitWallet,
  resolveSwapSigningStep,
  verifyPermit2SignatureForWallet,
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

describe("resolveSwapSigningStep", () => {
  const permit2Payload = {
    domain: { name: "Permit2", chainId: 8453 },
    types: {},
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "50000000" },
    },
  };

  it("prefers token_approval when phase is token_approval", () => {
    expect(
      resolveSwapSigningStep({
        type: "transaction",
        phase: "token_approval",
        transaction: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x" },
      }),
    ).toBe("token_approval");
  });

  it("prefers token_approval when both approve tx and Permit2 payloads are present", () => {
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, 50_000_000n],
    });
    expect(
      resolveSwapSigningStep(
        {
          signingPayloads: [permit2Payload],
          transaction: { to: usdc, data: approveData },
        },
        usdc,
      ),
    ).toBe("token_approval");
  });

  it("returns permit2 when only typed data is present", () => {
    expect(resolveSwapSigningStep({ signingPayloads: [permit2Payload] })).toBe("permit2");
  });

  it("returns typed_data for gasless Order payloads", () => {
    expect(
      resolveSwapSigningStep({
        signingPayloads: [
          {
            domain: { name: "Gnosis Protocol", chainId: 1 },
            types: {},
            primaryType: "Order",
            message: { sellToken: "0xabc", buyToken: "0xdef", sellAmount: "1" },
          },
        ],
      }),
    ).toBe("typed_data");
  });
});

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

describe("resolvePermit2SubmitWallet", () => {
  const testAccount = ephemeralTestAccount();

  it("returns corrected signer when signature is from a different account", async () => {
    const permitSinglePayload: TypedDataPayload = {
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
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
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "50000000",
          expiration: "1784615532",
          nonce: "0",
        },
        spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
        sigDeadline: "1782025354",
      },
    };
    const signedTypedData = prepareTypedDataForWallet(permitSinglePayload as WalletTypedDataPayload);
    const signature = await testAccount.signTypedData({
      domain: signedTypedData.domain as {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: signedTypedData.types as Record<string, { name: string; type: string }[]>,
      primaryType: signedTypedData.primaryType,
      message: signedTypedData.message as Record<string, unknown>,
    });
    const resolved = await resolvePermit2SubmitWallet(
      permitSinglePayload,
      signature,
      WALLET_B,
      signedTypedData,
    );
    expect(resolved.corrected).toBe(true);
    expect(resolved.submitWallet).toBe(resolved.recoveredSigner);
    expect(resolved.submitWallet).not.toBe(getAddress(WALLET_B));
    expect(resolved.quoteWallet).toBe(getAddress(WALLET_B));
  });

  async function signPayload(payload: TypedDataPayload): Promise<{
    signature: string;
    signedTypedData: WalletTypedDataPayload;
  }> {
    const signedTypedData = prepareTypedDataForWallet(payload as WalletTypedDataPayload);
    const signature = await testAccount.signTypedData({
      domain: signedTypedData.domain as {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: signedTypedData.types as Record<string, { name: string; type: string }[]>,
      primaryType: signedTypedData.primaryType,
      message: signedTypedData.message as Record<string, unknown>,
    });
    return { signature, signedTypedData };
  }

  it("returns connected wallet when signature matches", async () => {
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
    const { signature, signedTypedData } = await signPayload(payloadForSigner);
    const resolved = await resolvePermit2SubmitWallet(
      payloadForSigner,
      signature,
      testAccount.address,
      signedTypedData,
    );
    expect(resolved.corrected).toBe(false);
    expect(resolved.submitWallet).toBe(getAddress(testAccount.address));
  });
});

describe("assertPermit2SignatureMatchesWallet", () => {
  const testAccount = ephemeralTestAccount();

  async function signPayload(payload: TypedDataPayload): Promise<{
    signature: string;
    signedTypedData: WalletTypedDataPayload;
  }> {
    const signedTypedData = prepareTypedDataForWallet(payload as WalletTypedDataPayload);
    const signature = await testAccount.signTypedData({
      domain: signedTypedData.domain as {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: signedTypedData.types as Record<string, { name: string; type: string }[]>,
      primaryType: signedTypedData.primaryType,
      message: signedTypedData.message as Record<string, unknown>,
    });
    return { signature, signedTypedData };
  }

  it("returns recovered signer when live wallet differs from signer", async () => {
    const permitSinglePayload: TypedDataPayload = {
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
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
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "50000000",
          expiration: "1784615532",
          nonce: "0",
        },
        spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
        sigDeadline: "1782025354",
      },
    };
    const { signature, signedTypedData } = await signPayload(permitSinglePayload);

    const recovered = await assertPermit2SignatureMatchesWallet(
      permitSinglePayload,
      signature,
      WALLET_B,
      signedTypedData,
    );
    expect(recovered).not.toBe(getAddress(WALLET_B));
    expect(getAddress(recovered)).toBe(recovered);
  });

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
    const { signature, signedTypedData } = await signPayload(payloadForSigner);

    const recovered = await assertPermit2SignatureMatchesWallet(
      payloadForSigner,
      signature,
      testAccount.address,
      signedTypedData,
    );
    expect(recovered).toBe(getAddress(testAccount.address));
  });

  it("rejects Order signature when verifying Permit2 payload", async () => {
    const testAccount = ephemeralTestAccount();
    const permitPayload: TypedDataPayload = {
      ...WITNESS_PAYLOAD,
      message: {
        ...WITNESS_PAYLOAD.message,
        witness: {
          ...(WITNESS_PAYLOAD.message.witness as Record<string, unknown>),
          swapper: testAccount.address,
        },
      },
    };
    const orderPayload: TypedDataPayload = {
      domain: { name: "Gnosis Protocol", chainId: 1 },
      types: {
        Order: [
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
        ],
      },
      primaryType: "Order",
      message: {
        sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        buyToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        sellAmount: "1000000",
      },
    };

    async function signPayload(payload: TypedDataPayload): Promise<{
      signature: string;
      signedTypedData: WalletTypedDataPayload;
    }> {
      const signedTypedData = prepareTypedDataForWallet(payload as WalletTypedDataPayload);
      const signature = await testAccount.signTypedData({
        domain: signedTypedData.domain as {
          name: string;
          chainId: number;
          verifyingContract: `0x${string}`;
        },
        types: signedTypedData.types as Record<string, { name: string; type: string }[]>,
        primaryType: signedTypedData.primaryType,
        message: signedTypedData.message as Record<string, unknown>,
      });
      return { signature, signedTypedData };
    }

    const permitSigned = await signPayload(permitPayload);
    const orderSigned = await signPayload(orderPayload);

    await expect(
      assertPermit2SignatureMatchesWallet(
        permitPayload,
        orderSigned.signature,
        testAccount.address,
        orderSigned.signedTypedData,
      ),
    ).rejects.toThrow(/does not verify/i);

    await expect(
      assertPermit2SignatureMatchesWallet(
        permitPayload,
        permitSigned.signature,
        testAccount.address,
        permitSigned.signedTypedData,
      ),
    ).resolves.toBe(getAddress(testAccount.address));
  });
});

describe("PermitSingle EIP-712 verify", () => {
  const testAccount = ephemeralTestAccount();

  const permitSinglePayload: TypedDataPayload = {
    domain: {
      name: "Permit2",
      chainId: 8453,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
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
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "50000000",
        expiration: "1784615532",
        nonce: "0",
      },
      spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      sigDeadline: "1782025354",
    },
  };

  it("signs and verifies PermitSingle with preserved quote fields", async () => {
    const typedData = prepareTypedDataForWallet(permitSinglePayload as WalletTypedDataPayload);
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
      verifyPermit2SignatureForWallet(typedData, signature, testAccount.address),
    ).resolves.toBe(true);
  });
});
