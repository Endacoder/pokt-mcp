import { describe, expect, it } from "vitest";
import { initRegistry, listChains, getRegistrySource } from "../index.js";

describe("registry integration", () => {
  it(
    "loads remote registry when online",
    async () => {
      await initRegistry();
      const chains = listChains();
      expect(chains.length).toBeGreaterThanOrEqual(50);
      expect(getRegistrySource()).toBe("remote");
      expect(chains.some((c: { protocol: string }) => c.protocol === "cosmos")).toBe(true);
    },
    15_000,
  );
});
