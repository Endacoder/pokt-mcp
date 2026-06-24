import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

let cached: { privateKey: `0x${string}`; account: PrivateKeyAccount } | undefined;

/** Ephemeral signing account for unit tests — key is generated at runtime, never committed. */
export function ephemeralTestAccount(): PrivateKeyAccount {
  if (!cached) {
    const privateKey = generatePrivateKey();
    cached = { privateKey, account: privateKeyToAccount(privateKey) };
  }
  return cached.account;
}

/** Raw key for libraries that require a private key buffer (e.g. @metamask/eth-sig-util). */
export function ephemeralTestPrivateKey(): `0x${string}` {
  ephemeralTestAccount();
  return cached!.privateKey;
}
