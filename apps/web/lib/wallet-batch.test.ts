import { describe, expect, it } from "vitest";
import { parseAtomicBatchSupported, transactionToWalletCall } from "./wallet-batch";

describe("wallet-batch", () => {
  it("detects atomic batch capability", () => {
    expect(
      parseAtomicBatchSupported(
        {
          "0x2105": { atomic: { status: "supported" } },
        },
        8453,
      ),
    ).toBe(true);
    expect(
      parseAtomicBatchSupported(
        {
          "0x2105": { atomic: { status: "unsupported" } },
        },
        8453,
      ),
    ).toBe(false);
  });

  it("normalizes transaction fields to wallet calls", () => {
    expect(
      transactionToWalletCall({
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        data: "0xdeadbeef",
        value: "0x0",
      }),
    ).toEqual({
      to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      data: "0xdeadbeef",
      value: "0x0",
    });
  });
});
