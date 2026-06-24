import { describe, expect, it } from "vitest";
import {
  applyGasSafetyBuffer,
  applyGasSafetyBufferHex,
  CONTRACT_CALL_GAS_FALLBACK,
} from "./gas-buffer.js";

describe("gas-buffer", () => {
  it("adds ~12.5% headroom to estimates", () => {
    expect(applyGasSafetyBuffer(200_000n)).toBe(225_000n);
    expect(applyGasSafetyBufferHex("200000")).toBe("0x36ee8");
  });

  it("enforces minimum intrinsic gas", () => {
    expect(applyGasSafetyBuffer(0n)).toBe(21_000n);
  });

  it("handles hex quantities", () => {
    expect(applyGasSafetyBufferHex("0x493e0")).toBe("0x5265c");
  });

  it("buffers contract fallback for swap calldata", () => {
    expect(applyGasSafetyBuffer(CONTRACT_CALL_GAS_FALLBACK)).toBe(393_750n);
  });
});
