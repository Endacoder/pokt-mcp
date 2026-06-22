import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { PERMIT2_ADDRESS } from "./permit2-approval";
import {
  validateSwapApprovalTransaction,
  isQuotedPermit2ApproveTx,
  isErc20ApproveTransaction,
} from "./swap-tx-validation";

const UNISWAP_UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";

describe("validateSwapApprovalTransaction", () => {
  const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  it("accepts Permit2 approve on quoted token", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxUint256],
    });
    expect(() =>
      validateSwapApprovalTransaction({ to: usdc, data, value: "0x0" }, usdc),
    ).not.toThrow();
  });

  it("rejects approve to wrong spender", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: ["0x1111111111111111111111111111111111111111", maxUint256],
    });
    expect(() =>
      validateSwapApprovalTransaction({ to: usdc, data, value: "0x0" }, usdc),
    ).toThrow(/Permit2/);
  });

  it("rejects transaction to wrong token", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxUint256],
    });
    expect(() =>
      validateSwapApprovalTransaction(
        { to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", data, value: "0x0" },
        usdc,
      ),
    ).toThrow(/but this quote is for/i);
  });

  it("does not treat router swap execution as ERC20 approve", () => {
    expect(
      isErc20ApproveTransaction({
        to: UNISWAP_UNIVERSAL_ROUTER,
        data: "0x3593564c00000000000000000000000000000000000000000000000000000000",
        value: "0x0",
      }),
    ).toBe(false);
  });

  it("detects quoted Permit2 approve tx", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxUint256],
    });
    expect(isQuotedPermit2ApproveTx({ to: usdc, data, value: "0x0" }, usdc)).toBe(true);
    expect(
      isQuotedPermit2ApproveTx(
        { to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", data, value: "0x0" },
        usdc,
      ),
    ).toBe(false);
  });
});
