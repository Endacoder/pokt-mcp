import { describe, expect, it, vi } from "vitest";
import { createNlRpcEngine } from "./index.js";
import {
  extractBlockRange,
  formatTransferEvents,
  isTransferEventQuery,
  matchTransferEventFollowUp,
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

  it("matches transfer dispute follow-up from session context", () => {
    const sessionContext = {
      lastTransferQuery: {
        chain: "eth",
        tokenSymbol: "USDC",
        walletAddress: wallet,
        blockRange: 2000,
        hadEmptyResult: true,
      },
    };

    const prevKey = process.env.EXPLORER_API_KEY;
    process.env.EXPLORER_API_KEY = "test-key";
    try {
      const recheckFollowUp = matchTransferEventFollowUp("ive received tokens", sessionContext);
      expect(recheckFollowUp?.method).toBe("__transfer_events__");
      expect(recheckFollowUp?.params).toEqual(["eth", "USDC", wallet, 2000, true]);
    } finally {
      if (prevKey === undefined) delete process.env.EXPLORER_API_KEY;
      else process.env.EXPLORER_API_KEY = prevKey;
    }

    const balanceIntent = matchTransferEventFollowUp("what balance do I have", sessionContext);
    expect(balanceIntent?.method).toBe("__erc20_balance__");
    expect(balanceIntent?.params).toEqual(["eth", "USDC", wallet]);
  });

  it("falls back to token balance on dispute follow-up without explorer key", () => {
    const sessionContext = {
      lastTransferQuery: {
        chain: "eth",
        tokenSymbol: "USDC",
        walletAddress: wallet,
        blockRange: 2000,
        hadEmptyResult: true,
      },
    };
    const prevKey = process.env.EXPLORER_API_KEY;
    delete process.env.EXPLORER_API_KEY;
    try {
      const followUp = matchTransferEventFollowUp("ive received tokens", sessionContext);
      expect(followUp?.method).toBe("__erc20_balance__");
    } finally {
      if (prevKey === undefined) delete process.env.EXPLORER_API_KEY;
      else process.env.EXPLORER_API_KEY = prevKey;
    }
  });

  it("infers transfer context from chat history when session is missing", () => {
    const history = [
      {
        role: "user" as const,
        content: `Recent USDC Transfer events for ${wallet} on eth`,
      },
      {
        role: "assistant" as const,
        content: `No USDC Transfer events for 0xd8dA…6045 on Ethereum in the last 2,000 blocks.`,
      },
    ];
    const prevKey = process.env.EXPLORER_API_KEY;
    process.env.EXPLORER_API_KEY = "test-key";
    try {
      const followUp = matchTransferEventFollowUp("I've received tokens", undefined, history);
      expect(followUp?.method).toBe("__transfer_events__");
      expect(followUp?.params).toEqual(["eth", "USDC", wallet, 2000, true]);
    } finally {
      if (prevKey === undefined) delete process.env.EXPLORER_API_KEY;
      else process.env.EXPLORER_API_KEY = prevKey;
    }
  });

  it("checks connected wallet balances on dispute follow-up without prior transfer context", () => {
    const followUp = matchTransferEventFollowUp("I've received tokens", {
      connectedAddress: wallet,
      defaultChain: "base",
    });
    expect(followUp?.method).toBe("__wallet_balances__");
    expect(followUp?.params).toEqual(["base", wallet]);
  });

  it("requires transfer context when wallet is not connected", () => {
    expect(() => matchTransferEventFollowUp("I've received tokens")).toThrow("TRANSFER_CONTEXT_REQUIRED");
  });

  it("parses ive received tokens when session remembers prior transfer query", async () => {
    const engine = createNlRpcEngine({ llm: null });
    const prevKey = process.env.EXPLORER_API_KEY;
    process.env.EXPLORER_API_KEY = "test-key";
    try {
      const parsed = await engine.parse("ive received tokens", {
        lastTransferQuery: {
          chain: "eth",
          tokenSymbol: "USDC",
          walletAddress: wallet,
          blockRange: 2000,
          hadEmptyResult: true,
        },
      });
      expect(parsed.intent.method).toBe("__transfer_events__");
      expect(parsed.intent.params[4]).toBe(true);
    } finally {
      if (prevKey === undefined) delete process.env.EXPLORER_API_KEY;
      else process.env.EXPLORER_API_KEY = prevKey;
    }
  });

  it("parses ive received tokens for connected wallet without prior transfer query", async () => {
    const engine = createNlRpcEngine({ llm: null });
    const parsed = await engine.parse("I've received tokens", {
      connectedAddress: wallet,
      defaultChain: "eth",
    });
    expect(parsed.intent.method).toBe("__wallet_balances__");
    expect(parsed.intent.params).toEqual(["eth", wallet]);
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
