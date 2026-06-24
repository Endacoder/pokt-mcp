import { describe, expect, it } from "vitest";
import {
  extractOrderHash,
  extractTxHash,
  isInvalidSignatureSubmitError,
  isWalletAccountMismatchError,
  normalizeSwapSignature,
} from "./intent-swap-execute.js";

describe("extractTxHash", () => {
  it("does not treat orderHash as on-chain txHash", () => {
    const orderOnly = {
      orderHash: "0xb1c414c10247bbb2ad5ff3683cca69138fb4c66b781d5ad49c5fbe6726b5f388",
    };
    expect(extractTxHash(orderOnly)).toBeUndefined();
    expect(extractOrderHash(orderOnly)).toBe(orderOnly.orderHash);
  });

  it("accepts valid transactionHash", () => {
    const tx = "0x" + "ab".repeat(32);
    expect(extractTxHash({ transactionHash: tx })).toBe(tx);
  });
});

describe("normalizeSwapSignature", () => {
  it("normalizes v from 0/1 to 27/28 and lowercases", () => {
    const sig =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" +
      "00";
    expect(normalizeSwapSignature(sig)).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" +
        "1b",
    );
  });

  it("leaves tx hashes unchanged", () => {
    const tx = "0x" + "ab".repeat(32);
    expect(normalizeSwapSignature(tx)).toBe(tx);
  });
});

describe("isInvalidSignatureSubmitError", () => {
  it("detects 1inch invalid signature failures", () => {
    expect(
      isInvalidSignatureSubmitError(
        'oneinch_fusion: Order submit failed: {"message":"invalid signature","code":"ORDER_SAVER_ERROR"}',
      ),
    ).toBe(true);
  });

  it("detects Permit2 signer vs submit wallet mismatch", () => {
    expect(
      isWalletAccountMismatchError(
        "uniswap: Permit2 signature is from 0xF5Dd567A9e02D0078CFC3789641ffb8Ffcd0bbE0 but submit used 0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f.",
      ),
    ).toBe(true);
    expect(isInvalidSignatureSubmitError("uniswap: Permit2 signature is from 0xabc but submit used 0xdef")).toBe(
      true,
    );
  });
});
