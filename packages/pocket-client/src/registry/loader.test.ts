import { describe, expect, it } from "vitest";
import { loadBundledRegistry, rebuildAliasIndex } from "./loader.js";

describe("registry loader", () => {
  it("loads bundled fallback with endpoints", () => {
    const chains = loadBundledRegistry();
    expect(chains.length).toBeGreaterThanOrEqual(20);
    expect(chains.find((c) => c.slug === "eth")?.endpoint).toBe("https://eth.api.pocket.network");
    expect(chains.every((c) => c.status === "active")).toBe(true);
  });

  it("rebuilds alias index including chain ids", () => {
    const { byAlias } = rebuildAliasIndex(loadBundledRegistry());
    expect(byAlias.get("ethereum")?.slug).toBe("eth");
    expect(byAlias.get("137")?.slug).toBe("poly");
    expect(byAlias.get("optimism")?.slug).toBe("opt");
  });

  it("maps optimism portal slug from bundled overrides", () => {
    const opt = loadBundledRegistry().find((c) => c.slug === "opt");
    expect(opt?.endpoint).toBe("https://op.api.pocket.network");
    expect(opt?.portalSlug).toBe("op");
  });
});
