import { describe, expect, it } from "vitest";
import {
  unwrapInstructionsResponse,
  unwrapStatusResponse,
  unwrapSubmitResponse,
} from "./intent-mcp-client.js";

describe("MCP response unwrapping", () => {
  it("unwraps submit_signed_intent result envelope", () => {
    const unwrapped = unwrapSubmitResponse({
      result: {
        status: "pending_tx_signature",
        nextUnsignedIntent: { type: "transaction", payload: { to: "0xabc" } },
      },
    });
    expect(unwrapped.status).toBe("pending_tx_signature");
    expect(unwrapped.nextUnsignedIntent).toEqual({ type: "transaction", payload: { to: "0xabc" } });
  });

  it("unwraps get_intent_status status envelope", () => {
    const unwrapped = unwrapStatusResponse({
      status: {
        intentId: "int_123",
        status: "pending_signature",
        txHash: undefined,
      },
    });
    expect(unwrapped.intentId).toBe("int_123");
    expect(unwrapped.status).toBe("pending_signature");
  });

  it("unwraps get_signing_instructions instructions envelope", () => {
    const unwrapped = unwrapInstructionsResponse({
      instructions: {
        transaction: { to: "0xrouter", data: "0xdeadbeef" },
      },
    });
    expect(unwrapped.transaction).toEqual({ to: "0xrouter", data: "0xdeadbeef" });
  });
});
