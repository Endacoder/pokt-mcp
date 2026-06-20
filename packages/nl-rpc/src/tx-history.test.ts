import { describe, expect, it, vi } from "vitest";
import {
  fetchPaymentFromMe,
  fetchTxHistory,
  formatPaymentFromMe,
  formatTxHistory,
  isTxHistoryQuery,
  matchPaymentFromMeQuery,
  matchTxHistoryQuery,
} from "./tx-history.js";

describe("isTxHistoryQuery", () => {
  it("detects recent transaction history queries", () => {
    expect(isTxHistoryQuery("whats the last 5 transaction on my account with eth")).toBe(true);
    expect(isTxHistoryQuery("show recent activity")).toBe(true);
    expect(isTxHistoryQuery("transaction history for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    expect(isTxHistoryQuery("latest block on eth")).toBe(false);
  });
});

describe("matchTxHistoryQuery", () => {
  it("returns tx history intent with limit and chain", () => {
    const intent = matchTxHistoryQuery("whats the last 5 transaction on my account with eth", {
      connectedAddress: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__tx_history__");
    expect(intent?.params).toEqual(["eth", "0xae8609a54a52501bb76c104d920efab7f52a6bcb", 5]);
  });

  it("throws when wallet not connected for my account query", () => {
    expect(() =>
      matchTxHistoryQuery("whats the last 5 transaction on my account with eth", { defaultChain: "eth" }),
    ).toThrow("WALLET_NOT_CONNECTED");
  });
});

describe("matchPaymentFromMeQuery", () => {
  it("returns payment-from-me intent for connected wallet", () => {
    const intent = matchPaymentFromMeQuery(
      "has 0x2b085d624f1663bf8661d5bc20a8d9883714405a ever received anything from me",
      {
        connectedAddress: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
        defaultChain: "eth",
      },
    );
    expect(intent?.method).toBe("__payment_from_me__");
    expect(intent?.params).toEqual([
      "eth",
      "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
      "0x2b085d624f1663bf8661d5bc20a8d9883714405a",
    ]);
  });

  it("throws when wallet not connected", () => {
    expect(() =>
      matchPaymentFromMeQuery(
        "has 0x2b085d624f1663bf8661d5bc20a8d9883714405a ever received anything from me",
        { defaultChain: "eth" },
      ),
    ).toThrow("WALLET_NOT_CONNECTED");
  });
});

describe("fetchPaymentFromMe", () => {
  it("finds native transfers from sender to recipient", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      const action = u.searchParams.get("action");
      if (action === "txlist") {
        return Response.json({
          status: "1",
          result: [
            {
              hash: "0xabc",
              from: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
              to: "0x2b085d624f1663bf8661d5bc20a8d9883714405a",
              value: "1000000000000000",
              blockNumber: "123",
            },
          ],
        });
      }
      return Response.json({ status: "1", result: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPLORER_API_KEY", "test-key");

    const result = await fetchPaymentFromMe(
      { rpc: vi.fn() } as never,
      "eth",
      "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
      "0x2b085d624f1663bf8661d5bc20a8d9883714405a",
    );

    expect(result.everReceived).toBe(true);
    expect(formatPaymentFromMe(result)).toContain("Yes");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("fetchTxHistory", () => {
  it("uses explorer API when key is configured", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "1",
        result: [
          {
            hash: "0xabc123",
            from: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
            to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            value: "1000000000000000000",
            blockNumber: "12345",
            timeStamp: "1700000000",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPLORER_API_KEY", "test-key");

    const pocket = { rpc: vi.fn() };
    const result = await fetchTxHistory(
      pocket as never,
      "eth",
      "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
      5,
    );

    expect(result.source).toBe("explorer");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.direction).toBe("out");
    expect(formatTxHistory(result)).toContain("Last 1 transactions");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requires explorer API key", async () => {
    vi.unstubAllEnvs();
    const pocket = { rpc: vi.fn() };
    await expect(
      fetchTxHistory(pocket as never, "eth", "0xae8609a54a52501bb76c104d920efab7f52a6bcb", 5),
    ).rejects.toThrow("EXPLORER_API_KEY required");
  });
});
