const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/** Check whether a hash resolves to an on-chain transaction (any chain RPC). */
export async function verifyTxOnChain(
  txHash: string,
  chainId: number,
): Promise<{ found: boolean; status?: string }> {
  if (!TX_HASH_RE.test(txHash)) return { found: false };
  const rpc =
    chainId === 8453
      ? "https://base.api.pocket.network"
      : chainId === 137
        ? "https://poly.api.pocket.network"
        : chainId === 42161
          ? "https://arb-one.api.pocket.network"
          : "https://eth.api.pocket.network";
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
    });
    const json = (await res.json()) as { result?: { status?: string } | null };
    if (json.result && typeof json.result === "object") {
      return { found: true, status: json.result.status };
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}
