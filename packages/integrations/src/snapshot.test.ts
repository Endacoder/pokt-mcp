import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActiveProposals, resolveSnapshotSpace } from "./snapshot.js";

describe("snapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SNAPSHOT_API_KEY;
  });

  it("resolves known DAO spaces", () => {
    expect(resolveSnapshotSpace("Active UNI proposals")).toBe("uniswapgovernance.eth");
    expect(resolveSnapshotSpace("governance for aave")).toBe("aavedao.eth");
  });

  it("queries hub without SNAPSHOT_API_KEY", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          proposals: [
            {
              id: "0xabc",
              title: "Test proposal",
              body: "",
              state: "active",
              start: 1,
              end: 2,
              scores: [1],
              scores_total: 1,
              quorum: 0,
              choices: ["Yes"],
              space: { id: "uniswapgovernance.eth", name: "Uniswap" },
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const proposals = await fetchActiveProposals("uniswapgovernance.eth", 5);

    expect(proposals).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBeUndefined();
  });
});
