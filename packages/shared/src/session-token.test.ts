import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken, sessionTokenMatchesSession } from "./session-token.js";

const SECRET = "test-signing-secret";
const SESSION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

describe("session token", () => {
  it("signs and verifies a token", async () => {
    const { token, expiresAt } = await signSessionToken(SESSION_ID, SECRET, 60_000);
    const payload = await verifySessionToken(token, SECRET);

    expect(payload).toEqual({ sessionId: SESSION_ID, exp: expiresAt });
    expect(sessionTokenMatchesSession(payload!, SESSION_ID)).toBe(true);
  });

  it("rejects tampered tokens", async () => {
    const { token } = await signSessionToken(SESSION_ID, SECRET, 60_000);
    const tampered = token.replace(/a/g, "b");
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const { token } = await signSessionToken(SESSION_ID, SECRET, -1);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });
});
