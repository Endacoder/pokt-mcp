import { describe, expect, it } from "vitest";
import { createPocketClient, getChain, listChains, resolveChain } from "../src/index.js";

describe("chain registry", () => {
  it("lists at least 20 chains", () => {
    expect(listChains().length).toBeGreaterThanOrEqual(20);
  });

  it("resolves aliases", () => {
    expect(resolveChain("ethereum")?.slug).toBe("eth");
    expect(resolveChain("137")?.slug).toBe("poly");
    expect(getChain("base")?.chainId).toBe(8453);
  });

  it("builds pocket portal endpoints", () => {
    const eth = getChain("eth");
    expect(eth?.endpoint).toBe("https://eth.api.pocket.network");
  });

  it("maps portal slugs that differ from internal chain slugs", () => {
    expect(getChain("opt")?.endpoint).toBe("https://op.api.pocket.network");
    expect(getChain("zksync")?.endpoint).toBe("https://zksync-era.api.pocket.network");
  });
});

describe("pocket client integration", () => {
  const pocket = createPocketClient();

  it("fetches block number on eth, base, poly", async () => {
    for (const chain of ["eth", "base", "poly"]) {
      const resp = await pocket.rpc<string>(chain, "eth_blockNumber", []);
      expect(resp.result).toMatch(/^0x[0-9a-f]+$/i);
      expect(resp.meta.latencyMs).toBeGreaterThan(0);
    }
  }, 30_000);

  it("uses cache for repeated blockNumber calls", async () => {
    const first = await pocket.rpc<string>("eth", "eth_blockNumber", []);
    const second = await pocket.rpc<string>("eth", "eth_blockNumber", []);
    expect(first.result).toBe(second.result);
    expect(second.meta.latencyMs).toBeLessThanOrEqual(first.meta.latencyMs);
  }, 30_000);
});
