import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "./index.js";
import {
  encodeErc20TransferCalldata,
  isTokenSendQuery,
  matchTokenSendQuery,
  wantsTokenSend,
} from "./token-send.js";
import { wantsSend } from "./patterns.js";

describe("token send", () => {
  const wallet = "0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f";
  const recipient = "0xAE8609A54a52501bb76C104d920efaB7F52a6bcB";

  it("detects ERC-20 send queries", () => {
    expect(isTokenSendQuery(`send 1 usdc to ${recipient}`)).toBe(true);
    expect(wantsTokenSend(`send 1 usdc to ${recipient}`)).toEqual({
      amount: 1,
      symbol: "USDC",
      to: recipient,
    });
  });

  it("does not treat native eth sends as token sends", () => {
    expect(wantsTokenSend(`send 1 eth to ${recipient}`)).toBeNull();
    expect(wantsSend(`send 1 eth to ${recipient}`)).toEqual({ amount: 1, to: recipient });
  });

  it("builds token send intent for connected wallet", () => {
    const intent = matchTokenSendQuery(`send 1 usdc to ${recipient}`, {
      connectedAddress: wallet,
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__token_send__");
    expect(intent?.action).toBe("write");
    expect(intent?.params?.[0]).toMatchObject({
      tokenSymbol: "USDC",
      tokenAmount: "1",
      recipient,
      value: "0x0",
    });
  });

  it("encodes ERC-20 transfer calldata", () => {
    const data = encodeErc20TransferCalldata(recipient, 1_000_000n);
    expect(data.startsWith("0xa9059cbb")).toBe(true);
  });

  it("routes via parse engine with wallet confirmation", async () => {
    const parsed = await createNlRpcEngine({ llm: null }).parse(`send 1 usdc to ${recipient}`, {
      connectedAddress: wallet,
      defaultChain: "eth",
    });
    expect(parsed.intent.method).toBe("__token_send__");
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.pendingAction).toBe("wallet_send_transaction");
  });

  it("requires connected wallet", () => {
    expect(() => matchTokenSendQuery(`send 1 usdc to ${recipient}`, { defaultChain: "eth" })).toThrow(
      "WALLET_NOT_CONNECTED",
    );
  });
});
