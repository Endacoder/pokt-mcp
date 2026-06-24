import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertActiveWalletMatches,
  assertSinglePermittedAccount,
  assertWalletPersonalSignMatches,
  preparePermit2SigningAccount,
  resolveActiveSigningAddress,
} from "./swap-api";
import {
  clearWalletBinding,
  setActiveWalletProvider,
  setBoundConnectedAddress,
} from "./wallet-provider";
import { ephemeralTestAccount } from "./test-ephemeral-account";

const WALLET_A = "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f";
const WALLET_B = "0xC433aeE1BA16968a7C5A86Fa48acfD37d76DcD71";
const TEST_ACCOUNT = ephemeralTestAccount();

function mockProvider(options: {
  accounts: string[];
  selectedAddress?: string | null;
  personalSignAccount?: typeof TEST_ACCOUNT;
}) {
  return {
    selectedAddress: options.selectedAddress ?? null,
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "personal_sign") {
        const message = String(params?.[0] ?? "");
        const signer = options.personalSignAccount ?? TEST_ACCOUNT;
        return signer.signMessage({ message });
      }
      if (
        method === "eth_requestAccounts" ||
        method === "eth_accounts" ||
        method === "wallet_requestPermissions" ||
        method === "wallet_revokePermissions"
      ) {
        return method === "wallet_revokePermissions" ? null : options.accounts;
      }
      throw new Error(`unexpected method ${method}`);
    }),
  } as NonNullable<Window["ethereum"]>;
}

function bindProvider(
  provider: NonNullable<Window["ethereum"]>,
  address: string,
) {
  setActiveWalletProvider(provider, "injected", address);
  setBoundConnectedAddress(address);
}

afterEach(() => {
  clearWalletBinding();
});

describe("resolveActiveSigningAddress", () => {
  it("uses eth_requestAccounts[0] even when selectedAddress is stale", async () => {
    const provider = mockProvider({
      accounts: [WALLET_B],
      selectedAddress: WALLET_A,
    });
    const resolved = await resolveActiveSigningAddress(provider);
    expect(resolved.signing).toBe("0xC433aeE1BA16968a7C5A86Fa48acfD37d76DcD71");
    expect(resolved.selected).toBe("0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f");
  });

  it("falls back to permitted account when selectedAddress is unset", async () => {
    const provider = mockProvider({ accounts: [WALLET_A] });
    const resolved = await resolveActiveSigningAddress(provider);
    expect(resolved.signing).toBe("0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f");
  });
});

describe("assertActiveWalletMatches", () => {
  it("throws when eth_requestAccounts differs from expected swap wallet", async () => {
    const provider = mockProvider({
      accounts: [WALLET_B],
      selectedAddress: WALLET_A,
    });
    bindProvider(provider, WALLET_A);

    await expect(assertActiveWalletMatches(WALLET_A)).rejects.toMatchObject({
      code: "WALLET_ACCOUNT_MISMATCH",
    });
    await expect(assertActiveWalletMatches(WALLET_A)).rejects.toThrow(/connected wallet is/i);
  });

  it("passes when selected and expected accounts align", async () => {
    const provider = mockProvider({
      accounts: [WALLET_A],
      selectedAddress: WALLET_A,
    });
    bindProvider(provider, WALLET_A);

    await expect(assertActiveWalletMatches(WALLET_A)).resolves.toBe(
      "0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f",
    );
  });
});

describe("assertSinglePermittedAccount", () => {
  it("throws when multiple accounts are authorized for the site", async () => {
    const provider = mockProvider({
      accounts: [WALLET_A, WALLET_B],
      selectedAddress: WALLET_A,
    });
    bindProvider(provider, WALLET_A);

    await expect(assertSinglePermittedAccount(WALLET_A)).rejects.toMatchObject({
      code: "WALLET_ACCOUNT_MISMATCH",
    });
    await expect(assertSinglePermittedAccount(WALLET_A)).rejects.toThrow(/Only/i);
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_revokePermissions" }),
    );
  });
});

describe("preparePermit2SigningAccount", () => {
  it("skips re-auth when the bound wallet is already the only permitted account", async () => {
    const addr = TEST_ACCOUNT.address;
    const provider = mockProvider({
      accounts: [addr],
      selectedAddress: addr,
      personalSignAccount: TEST_ACCOUNT,
    });
    bindProvider(provider, addr);

    await expect(preparePermit2SigningAccount(addr)).resolves.toBe(addr);
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_revokePermissions" }),
    );
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "personal_sign" }),
    );
  });

  it("re-authorizes when multiple accounts are permitted", async () => {
    const addr = TEST_ACCOUNT.address;
    let accounts = [addr, WALLET_B];
    const provider = {
      selectedAddress: addr,
      request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "personal_sign") {
          return TEST_ACCOUNT.signMessage({ message: String(params?.[0] ?? "") });
        }
        if (method === "wallet_revokePermissions") {
          accounts = [addr];
          return null;
        }
        if (
          method === "eth_requestAccounts" ||
          method === "eth_accounts" ||
          method === "wallet_requestPermissions"
        ) {
          return accounts;
        }
        throw new Error(`unexpected method ${method}`);
      }),
    } as NonNullable<Window["ethereum"]>;
    bindProvider(provider, addr);

    await expect(preparePermit2SigningAccount(addr)).resolves.toBe(addr);
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_revokePermissions" }),
    );
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "personal_sign" }),
    );
  });

  it("throws when MetaMask re-authorizes a different account", async () => {
    const provider = mockProvider({ accounts: [WALLET_B], selectedAddress: WALLET_B });
    bindProvider(provider, WALLET_A);

    await expect(preparePermit2SigningAccount(WALLET_A)).rejects.toMatchObject({
      code: "WALLET_ACCOUNT_MISMATCH",
    });
  });
});

describe("assertWalletPersonalSignMatches", () => {
  it("passes when personal_sign recovers to the expected wallet", async () => {
    const addr = TEST_ACCOUNT.address;
    const provider = mockProvider({
      accounts: [addr],
      personalSignAccount: TEST_ACCOUNT,
    });
    bindProvider(provider, addr);

    await expect(assertWalletPersonalSignMatches(addr)).resolves.toBeUndefined();
  });
});
