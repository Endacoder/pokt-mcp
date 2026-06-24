import { describe, expect, it } from "vitest";
import { checksumAddress, parseValueToHex, normalizeGasQuantity } from "./index.js";

describe("tx-builder", () => {
  it("checksums valid addresses", () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(checksumAddress(addr.toLowerCase())).toBe(addr);
  });

  it("checksums all-lowercase addresses from external APIs", () => {
    const lower = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(checksumAddress(lower)).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("rejects invalid addresses", () => {
    expect(() => checksumAddress("not-an-address")).toThrow(/Invalid address/);
  });

  it("parses ether values to hex wei", () => {
    expect(parseValueToHex("1")).toBe("0xde0b6b3a7640000");
  });

  it("normalizes decimal gas limits to hex", () => {
    expect(normalizeGasQuantity("300000")).toBe("0x493e0");
    expect(normalizeGasQuantity("0x493e0")).toBe("0x493e0");
  });

  it("buffers estimated gas for safe transmission", async () => {
    const { applyGasSafetyBufferHex } = await import("@pokt-mcp/shared");
    expect(applyGasSafetyBufferHex("200000")).toBe("0x36ee8");
  });

  it("passes through hex values", () => {
    expect(parseValueToHex("0x10")).toBe("0x10");
  });
});
