import { describe, expect, it } from "vitest";
import {
  extractSigningPayloads,
  isInsufficientAllowanceError,
  isSimulationTransferFailedError,
  isConfirmationRequiredError,
  isQuoteExpiredError,
  isSigningPayloadUnavailableError,
  isOneinchOrderBuildError,
  normalizeSigningInstructions,
  validatePermitAgainstQuote,
  validateOrderAgainstQuote,
  OrderQuoteMismatchError,
} from "./intent-swap-types.js";

describe("extractSigningPayloads", () => {
  it("extracts Permit2 EIP-712 from nested eip712 block", () => {
    const payloads = extractSigningPayloads({
      instructions: {
        messageToSign: {
          eip712: {
            domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
            types: { PermitTransferFrom: [{ name: "spender", type: "address" }] },
            message: { spender: "0xabc", nonce: "1", deadline: "999", permitted: { token: "0xusdt", amount: "1000000" } },
            primaryType: "PermitTransferFrom",
          },
        },
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.primaryType).toBe("PermitTransferFrom");
  });

  it("extracts PermitWitnessTransferFrom from flat messageToSign", () => {
    const payloads = extractSigningPayloads({
      instructions: {
        messageToSign: {
          domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
          types: { PermitWitnessTransferFrom: [{ name: "spender", type: "address" }] },
          message: {
            spender: "0xabc",
            nonce: "1",
            deadline: "999",
            permitted: { token: "0xusdt", amount: "1000000" },
          },
          primaryType: "PermitWitnessTransferFrom",
        },
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.primaryType).toBe("PermitWitnessTransferFrom");
  });

  it("extracts CoW Order from instructions wrapper", () => {
    const payloads = extractSigningPayloads({
      instructions: {
        eip712Domain: { name: "Gnosis Protocol", version: "1", chainId: 1 },
        messageToSign: {
          signingScheme: "eip712",
          chainId: 1,
          order: {
            kind: "sell",
            appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
            validTo: 1781945333,
            buyToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            receiver: "0x1111111111111111111111111111111111111111",
            buyAmount: "1",
            feeAmount: "1",
            sellToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
            sellAmount: "1000000",
            partiallyFillable: false,
            sellTokenBalanceOffset: "0",
            buyTokenBalanceOffset: "0",
          },
        },
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.primaryType).toBe("Order");
  });
});

describe("normalizeSigningInstructions", () => {
  it("adds signingPayloads for wallet signing", () => {
    const normalized = normalizeSigningInstructions(
      { intent: { intentId: "int_1" } },
      {
        instructions: {
          messageToSign: {
            eip712: {
              domain: { name: "Permit2", chainId: 1 },
              types: { Order: [] },
              message: { foo: "bar" },
              primaryType: "Order",
            },
          },
        },
      },
    );

    expect(normalized.signingPayloads).toHaveLength(1);
    expect(normalized.primaryType).toBe("Order");
  });

  it("throws when no signing payload is available", () => {
    expect(() => normalizeSigningInstructions({ intent: { intentId: "int_1" } }, {})).toThrow(
      /SIGNING_PAYLOAD_UNAVAILABLE/,
    );
  });
});

describe("isOneinchOrderBuildError", () => {
  it("detects feeReceiver errors", () => {
    expect(
      isOneinchOrderBuildError(
        'oneinch_fusion: Order build failed: {"code":"FEE_RECEIVER_REQUIRED","description":"feeReceiver is required when fee is provided"}',
      ),
    ).toBe(true);
  });
});

describe("isConfirmationRequiredError", () => {
  it("detects Intent MCP confirmation requirement", () => {
    expect(
      isConfirmationRequiredError(
        "Wallet confirmation signature required — call POST /v1/quotes/confirmation",
      ),
    ).toBe(true);
    expect(isConfirmationRequiredError("CONFIRMATION_REQUIRED")).toBe(true);
    expect(isConfirmationRequiredError("network error")).toBe(false);
  });
});

describe("isSigningPayloadUnavailableError", () => {
  it("detects signing payload errors", () => {
    expect(isSigningPayloadUnavailableError("SIGNING_PAYLOAD_UNAVAILABLE: foo")).toBe(true);
    expect(isSigningPayloadUnavailableError("network error")).toBe(false);
  });
});

describe("isInsufficientAllowanceError", () => {
  it("detects Uniswap allowance validation failures", () => {
    expect(
      isInsufficientAllowanceError(
        'Order submit failed: {"errorCode":"InputValidationError","detail":"Insufficient allowance"}',
      ),
    ).toBe(true);
    expect(isInsufficientAllowanceError("network error")).toBe(false);
  });
});

describe("isSimulationTransferFailedError", () => {
  it("detects router transferFrom simulation reverts", () => {
    expect(
      isSimulationTransferFailedError(
        "Simulation failed: Simulation reverted: EstimateGasExecutionError: Execution reverted with reason: TRANSFER_FROM_FAILED.",
      ),
    ).toBe(true);
    expect(isSimulationTransferFailedError("network error")).toBe(false);
  });
});

describe("isQuoteExpiredError", () => {
  it("detects expired quote messages", () => {
    expect(isQuoteExpiredError("Quote q_abc has expired. Request a new quote.")).toBe(true);
    expect(isQuoteExpiredError("QUOTE_EXPIRED")).toBe(true);
    expect(isQuoteExpiredError("network error")).toBe(false);
    expect(
      isQuoteExpiredError(
        "SIGNING_PAYLOAD_UNAVAILABLE: Intent MCP did not return wallet signing data.",
      ),
    ).toBe(false);
  });
});

describe("validatePermitAgainstQuote", () => {
  it("accepts permit amount matching quote", () => {
    expect(() =>
      validatePermitAgainstQuote(
        {
          signingPayloads: [
            {
              domain: { name: "Permit2", chainId: 1 },
              types: {},
              primaryType: "PermitTransferFrom",
              message: {
                permitted: {
                  token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                  amount: "152000000000000000000",
                },
              },
            },
          ],
        },
        {
          tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          amountAtomic: "152000000000000000000",
        },
      ),
    ).not.toThrow();
  });

  it("rejects permit amount larger than quote", () => {
    expect(() =>
      validatePermitAgainstQuote(
        {
          signingPayloads: [
            {
              domain: { name: "Permit2", chainId: 1 },
              types: {},
              primaryType: "PermitTransferFrom",
              message: {
                permitted: {
                  token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                  amount: "152000000000",
                },
              },
            },
          ],
        },
        {
          tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          amountAtomic: "152000000000000000000",
        },
      ),
    ).toThrow(/but this quote is for/i);
  });
});

describe("validateOrderAgainstQuote", () => {
  const expected = {
    tokenInAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokenOutAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    amountInAtomic: "2000000",
    chainId: 1,
  };

  it("accepts 1inch Order matching quote", () => {
    expect(() =>
      validateOrderAgainstQuote(
        {
          signingPayloads: [
            {
              domain: { name: "1inch Aggregation Router", chainId: 1 },
              types: {},
              primaryType: "Order",
              message: {
                makerAsset: expected.tokenInAddress,
                takerAsset: expected.tokenOutAddress,
                makingAmount: expected.amountInAtomic,
              },
            },
          ],
        },
        expected,
      ),
    ).not.toThrow();
  });

  it("rejects CoW Order with wrong sellAmount", () => {
    expect(() =>
      validateOrderAgainstQuote(
        {
          signingPayloads: [
            {
              domain: { name: "Gnosis Protocol", chainId: 1 },
              types: {},
              primaryType: "Order",
              message: {
                sellToken: expected.tokenInAddress,
                buyToken: expected.tokenOutAddress,
                sellAmount: "9999999",
              },
            },
          ],
        },
        expected,
      ),
    ).toThrow(OrderQuoteMismatchError);
  });

  it("rejects Order on wrong chain", () => {
    expect(() =>
      validateOrderAgainstQuote(
        {
          signingPayloads: [
            {
              domain: { chainId: 8453 },
              types: {},
              primaryType: "Order",
              message: {
                sellToken: expected.tokenInAddress,
                buyToken: expected.tokenOutAddress,
                sellAmount: expected.amountInAtomic,
              },
            },
          ],
        },
        expected,
      ),
    ).toThrow(/chainId 8453/i);
  });
});
