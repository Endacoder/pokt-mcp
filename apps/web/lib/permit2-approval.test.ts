import { describe, expect, it } from "vitest";
import {
  isNativeEthTokenAddress,
  isPermit2TypedDataPayload,
  isWalletRpcHttpError,
} from "./permit2-approval";

describe("permit2-approval", () => {
  it("detects MetaMask RPC HTTP failures", () => {
    expect(
      isWalletRpcHttpError({
        code: -32080,
        message: "RPC endpoint returned HTTP client error.",
        data: { httpStatus: 403 },
      }),
    ).toBe(true);
  });
  it("detects native ETH sentinel addresses", () => {
    expect(isNativeEthTokenAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE")).toBe(true);
    expect(isNativeEthTokenAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(false);
  });

  it("detects Permit2 typed data payloads", () => {
    expect(
      isPermit2TypedDataPayload({
        domain: { name: "Permit2", chainId: 8453 },
        primaryType: "PermitWitnessTransferFrom",
      }),
    ).toBe(true);
    expect(
      isPermit2TypedDataPayload({
        domain: { name: "Gnosis Protocol", chainId: 1 },
        primaryType: "Order",
      }),
    ).toBe(false);
  });
});
