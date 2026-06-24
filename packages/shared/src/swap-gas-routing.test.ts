import { describe, expect, it } from "vitest";
import {
  isUserPaidGasRequiredError,
  isUserPaidGasRoute,
  quoteRequiresGasAck,
} from "./swap-gas-routing.js";

describe("isUserPaidGasRoute", () => {
  it("detects Uniswap CLASSIC / LI.FI routes under Best price mode", () => {
    expect(
      isUserPaidGasRoute({
        executionMode: "any",
        route: "Uniswap CLASSIC",
      }),
    ).toBe(true);
    expect(
      isUserPaidGasRoute({
        executionMode: "any",
        route: "LI.FI",
      }),
    ).toBe(true);
  });

  it("does not treat gasless quotes as user-paid gas", () => {
    expect(
      isUserPaidGasRoute({
        executionMode: "gasless",
        route: "CoW Swap",
      }),
    ).toBe(false);
  });

  it("uses gasEstimateUsd when execution mode is ambiguous", () => {
    expect(
      isUserPaidGasRoute({
        executionMode: "any",
        gasEstimateUsd: 1.25,
      }),
    ).toBe(true);
  });
});

describe("quoteRequiresGasAck", () => {
  it("requires ack for explicit gas mode", () => {
    expect(quoteRequiresGasAck({ executionMode: "gas" })).toBe(true);
  });
});

describe("isUserPaidGasRequiredError", () => {
  it("detects Intent MCP gas-route mismatch errors", () => {
    expect(
      isUserPaidGasRequiredError(
        "prepare_intent only accepts gasless quotes. This quote requires user-paid network gas (Uniswap CLASSIC / LI.FI).",
      ),
    ).toBe(true);
  });
});
