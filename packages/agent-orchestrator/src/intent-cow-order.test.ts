import { describe, expect, it } from "vitest";
import { buildCowOrderTypedData } from "./intent-cow-order.js";

describe("buildCowOrderTypedData", () => {
  it("builds Order typed data from Intent MCP cowswap instructions", () => {
    const payload = buildCowOrderTypedData({
      eip712Domain: { name: "Gnosis Protocol", version: "1", chainId: 1 },
      messageToSign: {
        signingScheme: "eip712",
        chainId: 1,
        order: {
          from: "0x1111111111111111111111111111111111111111",
          kind: "sell",
          appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
          validTo: 1781945333,
          buyToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          receiver: "0x1111111111111111111111111111111111111111",
          buyAmount: "533055823164826",
          feeAmount: "81557",
          sellToken: "0xdac17f958d2ee523a2206206994597c13d831ec7",
          sellAmount: "918443",
          partiallyFillable: false,
          buyTokenBalanceOffset: "0",
          sellTokenBalanceOffset: "0",
        },
      },
    });

    expect(payload?.primaryType).toBe("Order");
    expect(payload?.domain.verifyingContract).toBe("0x9008D19f58AAbD9eD0D60971565AA8510560ab41");
    expect(payload?.message.sellTokenBalance).toBe("erc20");
    expect(payload?.message.sellAmount).toBe("918443");
  });
});
