import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COMPARE_GAS_CHAINS,
  executeCompareGas,
  extractCompareChains,
  formatCompareGas,
  isCompareGasQuery,
  matchCompareGasQuery,
  resolveCompareGasChains,
  wantsMultiChainGasCompare,
} from "./compare-gas.js";

describe("isCompareGasQuery", () => {
  it("detects compare gas queries", () => {
    expect(isCompareGasQuery("Compare gas on Base vs Arbitrum")).toBe(true);
    expect(isCompareGasQuery("Compare gas prices across chains")).toBe(true);
    expect(isCompareGasQuery("gas price on eth")).toBe(false);
  });
});

describe("wantsMultiChainGasCompare", () => {
  it("detects across chains phrasing", () => {
    expect(wantsMultiChainGasCompare("Compare gas prices across chains")).toBe(true);
    expect(wantsMultiChainGasCompare("Compare gas on Base vs Arbitrum")).toBe(false);
  });
});

describe("extractCompareChains", () => {
  it("extracts base and arbitrum in order", () => {
    expect(extractCompareChains("Compare gas on Base vs Arbitrum")).toEqual(["base", "arb-one"]);
  });
});

describe("resolveCompareGasChains", () => {
  it("uses defaults for across chains queries", () => {
    expect(resolveCompareGasChains("Compare gas prices across chains")).toEqual(
      DEFAULT_COMPARE_GAS_CHAINS,
    );
  });
});

describe("matchCompareGasQuery", () => {
  it("returns compare gas intent for two named chains", () => {
    const intent = matchCompareGasQuery("Compare gas on Base vs Arbitrum");
    expect(intent?.method).toBe("__compare_gas__");
    expect(intent?.params).toEqual(["base", "arb-one"]);
  });

  it("returns multi-chain intent for across chains query", () => {
    const intent = matchCompareGasQuery("Compare gas prices across chains");
    expect(intent?.method).toBe("__compare_gas__");
    expect(intent?.params).toEqual(DEFAULT_COMPARE_GAS_CHAINS);
  });
});

describe("executeCompareGas", () => {
  it("fetches gas on all requested chains via pocket rpc", async () => {
    const pocket = {
      rpc: vi.fn(async (chain: string) => ({
        result: chain === "base" ? "0x5f5e100" : chain === "arb-one" ? "0xbebc200" : "0x77359400",
        meta: { chain, method: "eth_gasPrice" },
      })),
    };

    const result = await executeCompareGas(pocket as never, ["base", "arb-one", "eth"]);
    expect(result.chains).toHaveLength(3);
    expect(result.cheaperChain).toBe("base");
    expect(formatCompareGas(result)).toContain("Pocket Network RPC");
    expect(pocket.rpc).toHaveBeenCalledTimes(3);
  });
});
