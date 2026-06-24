import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "./index.js";
import { chainIdIntent, formatGetChain, usesEvmChainIdRpc } from "./chain-metadata.js";

describe("chain metadata", () => {
  const engine = createNlRpcEngine({ llm: null });

  it("uses registry metadata for NEAR chain id queries", async () => {
    expect(usesEvmChainIdRpc("near")).toBe(false);
    const parsed = await engine.parse("get chain id for near");
    expect(parsed.intent.method).toBe("__get_chain__");
    expect(parsed.intent.chain).toBe("near");
  });

  it("keeps eth_chainId for EVM chains", async () => {
    expect(usesEvmChainIdRpc("poly")).toBe(true);
    const intent = chainIdIntent("poly");
    expect(intent.method).toBe("eth_chainId");
    expect(intent.chain).toBe("poly");
  });

  it("formats non-EVM chain metadata", () => {
    const text = formatGetChain({
      chain: {
        slug: "near",
        name: "Near",
        nativeSymbol: "NEAR",
        protocol: "near",
        endpoint: "https://near.api.pocket.network",
        aliases: [],
        network: "mainnet",
      },
    });
    expect(text).toContain("Near (near)");
    expect(text).toContain("no EVM chain ID");
  });
});
