/** Single source of truth for security policy defaults across packages. */
export const DEFAULT_MAINNET_CHAIN = "eth";

export const DEFAULT_ALLOWED_CHAINS = [
  "eth",
  "base",
  "arb-one",
  "poly",
  "opt",
  "avax",
] as const;

export const MAINNET_CHAIN_IDS = [1, 8453, 137, 42161, 10, 43114] as const;

export const TESTNET_CHAIN_IDS = [11155111, 84532, 421614, 11155420, 80002] as const;

export const DEFAULT_DENYLIST = [
  "personal_importRawKey",
  "personal_listAccounts",
  "eth_sign",
] as const;

export const DEFAULT_MAX_SEND_VALUE_ETH = 1.0;

export function parseAllowedChains(env?: string): string[] {
  const raw = env ?? process.env.WALLET_ALLOWED_CHAINS;
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [...DEFAULT_ALLOWED_CHAINS];
}

export function parseMethodDenylist(env?: string): string[] {
  const raw = env ?? process.env.RPC_METHOD_DENYLIST;
  const fromEnv = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return [...new Set([...DEFAULT_DENYLIST, ...fromEnv])];
}

export function isWriteRpcMethod(method: string): boolean {
  return (
    method === "eth_sendRawTransaction" ||
    method === "eth_sendTransaction" ||
    method.startsWith("personal_")
  );
}
