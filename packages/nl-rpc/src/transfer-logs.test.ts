import { describe, expect, it, vi } from "vitest";
import { createNlRpcEngine } from "./index.js";
import {
  extractBlockRange,
  formatTransferEvents,
  isTransferEventQuery,
  matchTransferEventQuery,
  wantsTransferEvents,
  type TransferEventsResult,
} from "./transfer-logs.js";

describe("transfer event patterns", () => {
  const wallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("matches recent USDC transfer events", () => {
    const query = `Recent USDC Transfer events for ${wallet} on eth`;
    expect(wantsTransferEvents(query)).toBe(true);
    expect(isTransferEventQuery(query)).toBe(true);
    const intent = matchTransferEventQuery(query);
    expect(intent?.method).toBe("__transfer_events__");
    expect(intent?.params).toEqual(["eth", "USDC", wallet, 2000]);
  });

  it("matches explicit block range", () => {
    const query = `USDC transfers for ${wallet} last 1000 blocks on eth`;
    expect(extractBlockRange(query)).toBe(1000);
    const intent = matchTransferEventQuery(query);
    expect(intent?.params[3]).toBe(1000);
  });

  it("requires a known token symbol", () => {
    const query = `Recent XYZ Transfer events for ${wallet} on eth`;
    expect(matchTransferEventQuery(query)).toBeNull();
  });
});

describe("transfer event execution", () => {
  it("formats incoming and outgoing events", async () => {
    const wallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const pocket = {
      rpc: vi.fn(async (_chain: string, method: string) => {
        if (method === "eth_blockNumber") return { result: "0x1000", meta: {} };
        if (method === "eth_getLogs") {
          return {
            result: [
              {
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x0000000000000000000000001111111111111111111111111111111111111111",
                  `0x000000000000000000000000${wallet.slice(2).toLowerCase()}`,
                ],
                data: "0x0000000000000000000000000000000000000000000000000000000005f5e100",
                blockNumber: "0xff0",
                transactionHash: "0xabc123",
                logIndex: "0x1",
              },
            ],
            meta: {},
          };
        }
        throw new Error(method);
      }),
    };

    const engine = createNlRpcEngine({ llm: null });
    const parsed = await engine.parse(`Recent USDC Transfer events for ${wallet} on eth`);
    expect(parsed.intent.method).toBe("__transfer_events__");

    const { executeIntent } = await import("./index.js");
    const output = await executeIntent(pocket as never, parsed.intent);
    const summary = formatTransferEvents(output as TransferEventsResult);
    expect(summary).toContain("USDC Transfer event");
    expect(summary).toContain("100 USDC");
  });
});
