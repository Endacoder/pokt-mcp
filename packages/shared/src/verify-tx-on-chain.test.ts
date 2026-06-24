import { describe, expect, it } from "vitest";
import { verifyTxOnChain } from "./verify-tx-on-chain.js";

describe("verifyTxOnChain", () => {
  it("rejects invalid hash without RPC call", async () => {
    await expect(verifyTxOnChain("not-a-hash", 1)).resolves.toEqual({ found: false });
  });
});
