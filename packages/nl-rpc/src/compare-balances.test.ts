import { describe, expect, it } from "vitest";
import {
  isCompareBalancesQuery,
  matchCompareBalancesQuery,
  resolveCompareBalanceChains,
} from "./compare-balances.js";

describe("compare balances", () => {
  it("detects compare balance queries", () => {
    expect(
      isCompareBalancesQuery(
        "Compare native balances on eth and base for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      ),
    ).toBe(true);
  });

  it("builds compare_balances intent", () => {
    const query =
      "Compare balance on ethereum, arbitrum, and base for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const intent = matchCompareBalancesQuery(query);
    expect(intent?.method).toBe("__compare_balances__");
    expect(intent?.params[0]).toMatch(/^0x/);
    expect((intent?.params[1] as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it("extracts named chains in order", () => {
    const chains = resolveCompareBalanceChains(
      "compare balance on base and eth for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
    expect(chains.length).toBeGreaterThanOrEqual(2);
  });
});
