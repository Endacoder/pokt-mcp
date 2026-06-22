import { describe, expect, it, vi } from "vitest";
import { assertActiveWalletMatches, assertSinglePermittedAccount, resolveActiveSigningAddress } from "./swap-api";

const WALLET_A = "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f";
const WALLET_B = "0xC433aeE1BA16968a7C5A86Fa48acfD37d76DcD71";

function mockProvider(options: {
  accounts: string[];
  selectedAddress?: string | null;
}) {
  return {
    selectedAddress: options.selectedAddress ?? null,
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return options.accounts;
      }
      throw new Error(`unexpected method ${method}`);
    }),
  } as NonNullable<Window["ethereum"]>;
}

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
    vi.stubGlobal("window", { ethereum: provider });

    await expect(assertActiveWalletMatches(WALLET_A)).rejects.toMatchObject({
      code: "WALLET_ACCOUNT_MISMATCH",
    });
    await expect(assertActiveWalletMatches(WALLET_A)).rejects.toThrow(/MetaMask will sign as/i);

    vi.unstubAllGlobals();
  });

  it("passes when selected and expected accounts align", async () => {
    const provider = mockProvider({
      accounts: [WALLET_A],
      selectedAddress: WALLET_A,
    });
    vi.stubGlobal("window", { ethereum: provider });

    await expect(assertActiveWalletMatches(WALLET_A)).resolves.toBe(
      "0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f",
    );

    vi.unstubAllGlobals();
  });
});

describe("assertSinglePermittedAccount", () => {
  it("throws when multiple accounts are authorized for the site", async () => {
    const provider = mockProvider({
      accounts: [WALLET_A, WALLET_B],
      selectedAddress: WALLET_A,
    });
    vi.stubGlobal("window", { ethereum: provider });

    await expect(assertSinglePermittedAccount(WALLET_A)).rejects.toMatchObject({
      code: "WALLET_ACCOUNT_MISMATCH",
    });
    await expect(assertSinglePermittedAccount(WALLET_A)).rejects.toThrow(/Connected sites/i);

    vi.unstubAllGlobals();
  });
});
