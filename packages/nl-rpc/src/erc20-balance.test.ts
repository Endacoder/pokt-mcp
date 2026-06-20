import { describe, expect, it } from "vitest";
import { matchErc20BalanceQuery } from "./erc20-balance.js";

describe("erc20-balance", () => {
  it("matches USDC balance query on Base", () => {
    const intent = matchErc20BalanceQuery(
      "USDC balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on Base",
    );
    expect(intent?.method).toBe("__erc20_balance__");
    expect(intent?.chain).toBe("base");
    expect(intent?.params[1]).toBe("USDC");
  });

  it("returns null without token symbol", () => {
    expect(
      matchErc20BalanceQuery("balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth"),
    ).toBeNull();
  });
});
