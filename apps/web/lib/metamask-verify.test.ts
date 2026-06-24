import { signTypedData, recoverTypedSignature, SignTypedDataVersion } from "@metamask/eth-sig-util";
import { describe, expect, it } from "vitest";
import { verifyMetaMaskTypedDataSigner } from "./metamask-typed-data";
import { ephemeralTestAccount, ephemeralTestPrivateKey } from "./test-ephemeral-account";
import { minimalTypedDataForWallet, type WalletTypedDataPayload } from "./typed-data-wallet";

const permitSinglePayload: WalletTypedDataPayload = {
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

describe("MetaMask PermitSingle verification", () => {
  const privateKey = ephemeralTestPrivateKey();
  const account = ephemeralTestAccount();

  it("verifies MetaMask-style PermitSingle signatures", () => {
    const typedData = JSON.parse(
      JSON.stringify(minimalTypedDataForWallet(permitSinglePayload)),
    ) as WalletTypedDataPayload;
    const signature = signTypedData({
      privateKey: Buffer.from(privateKey.slice(2), "hex"),
      data: typedData as Record<string, unknown>,
      version: SignTypedDataVersion.V4,
    });
    const recovered = recoverTypedSignature({
      data: typedData as Record<string, unknown>,
      signature,
      version: SignTypedDataVersion.V4,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
    expect(verifyMetaMaskTypedDataSigner(typedData, signature, account.address)).toBe(true);
  });
});
