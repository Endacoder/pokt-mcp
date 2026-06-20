import { describe, expect, it } from "vitest";
import {
  buildTxNotFoundInfo,
  enrichTxLookupOutput,
  formatTxNotFoundMessage,
  isTxLookupMethod,
  wantsTxExplain,
} from "./tx-lookup.js";

const HASH = "0x88df016429689c079c3bbe9e64b4f6bb4e2b1a6664245edaa2330f0a0b6b5891";

describe("tx-lookup", () => {
  it("detects tx lookup methods", () => {
    expect(isTxLookupMethod("eth_getTransactionByHash")).toBe(true);
    expect(isTxLookupMethod("eth_getTransactionReceipt")).toBe(true);
    expect(isTxLookupMethod("eth_getBalance")).toBe(false);
  });

  it("builds not-found info with explorer link for eth", () => {
    const info = buildTxNotFoundInfo("eth", HASH, "eth_getTransactionByHash");
    expect(info.found).toBe(false);
    expect(info.chainName).toBe("Ethereum Mainnet");
    expect(info.explorerUrl).toBe(`https://etherscan.io/tx/${HASH}`);
    expect(info.message).toContain("No transaction found");
    expect(info.suggestions.length).toBeGreaterThan(2);
  });

  it("enriches null RPC output with notFound payload", () => {
    const enriched = enrichTxLookupOutput("eth_getTransactionByHash", "eth", [HASH], {
      result: null,
      meta: { chain: "eth", method: "eth_getTransactionByHash" },
    });
    expect(enriched.result).toBeNull();
    expect(enriched.notFound).toMatchObject({ hash: HASH, chain: "eth" });
    expect(enriched.message).toContain("No transaction found");
  });

  it("leaves non-null results unchanged", () => {
    const tx = { hash: HASH, blockNumber: "0x1" };
    const output = enrichTxLookupOutput("eth_getTransactionByHash", "eth", [HASH], {
      result: tx,
      meta: {},
    });
    expect(output.result).toEqual(tx);
    expect(output.notFound).toBeUndefined();
  });

  it("formats a human-readable not-found message", () => {
    const info = buildTxNotFoundInfo("eth", HASH, "eth_getTransactionReceipt");
    const text = formatTxNotFoundMessage(info);
    expect(text).toContain("No receipt found");
    expect(text).toContain("Possible reasons:");
    expect(text).toContain("etherscan.io");
  });

  it("detects explain-tx queries", () => {
    expect(wantsTxExplain(`Explain tx ${HASH} on eth`)).toBe(true);
    expect(wantsTxExplain(`Transaction ${HASH} on eth`)).toBe(false);
  });
});
