import { describe, expect, it } from "vitest";
import { formatSendStatusAnswer, isSendStatusQuery } from "./send-status.js";

describe("isSendStatusQuery", () => {
  it("matches send status follow-ups", () => {
    expect(isSendStatusQuery("did that send succeed?")).toBe(true);
    expect(isSendStatusQuery("was my transaction confirmed")).toBe(true);
    expect(isSendStatusQuery("what is the transfer status")).toBe(true);
  });

  it("does not match new send requests", () => {
    expect(isSendStatusQuery("send 0.01 eth to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });

  it("does not match swap status follow-ups", () => {
    expect(isSendStatusQuery("did that swap succeed?")).toBe(false);
  });
});

describe("formatSendStatusAnswer", () => {
  it("formats successful receipt", () => {
    const text = formatSendStatusAnswer(
      {
        txHash: "0xabc",
        chain: "eth",
        chainName: "Ethereum Mainnet",
        to: "0xdef",
        valueNative: "0.01",
        nativeSymbol: "ETH",
        explorerUrl: "https://etherscan.io/tx/0xabc",
      },
      { status: "0x1", blockNumber: "0x10", transactionHash: "0xabc" },
    );
    expect(text).toContain("completed successfully");
    expect(text).toContain("0.01 ETH");
    expect(text).toContain("0xabc");
  });

  it("formats pending receipt", () => {
    const text = formatSendStatusAnswer(
      { txHash: "0xabc", chain: "eth" },
      null,
    );
    expect(text).toContain("still pending");
  });
});
