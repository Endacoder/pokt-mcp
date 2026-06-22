import { ensureSessionToken, getSessionId, sessionHeaders } from "./session";

/** Persist the active wallet on the API so quotes and swap routes use the correct address. */
export async function syncWalletSession(
  apiUrl: string,
  address: string,
  chainSlug?: string,
): Promise<void> {
  await ensureSessionToken(apiUrl);
  const sessionId = getSessionId();
  await fetch(`${apiUrl}/wallet/session`, {
    method: "POST",
    headers: sessionHeaders({ "Content-Type": "application/json" }, sessionId),
    body: JSON.stringify({ sessionId, address, chainSlug }),
  });
}
