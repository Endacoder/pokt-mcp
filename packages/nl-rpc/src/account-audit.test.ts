import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeAccountAudit,
  isAccountAuditQuery,
  matchAccountAuditQuery,
  CHAT_ACCOUNT_AUDIT_OPTIONS,
  ERC20_APPROVAL_TOPIC,
} from "./account-audit.js";

describe("isAccountAuditQuery", () => {
  it("detects audit and approval queries", () => {
    expect(isAccountAuditQuery("audit account 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    expect(isAccountAuditQuery("security audit my wallet")).toBe(true);
    expect(isAccountAuditQuery("check token approvals for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    expect(isAccountAuditQuery("latest block on eth")).toBe(false);
    expect(isAccountAuditQuery("audit log entries")).toBe(false);
  });
});

describe("matchAccountAuditQuery", () => {
  it("returns account audit intent for explicit address", () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const intent = matchAccountAuditQuery(`audit account ${addr}`);
    expect(intent?.method).toBe("__account_audit__");
    expect(intent?.params).toEqual([addr, CHAT_ACCOUNT_AUDIT_OPTIONS]);
  });

  it("throws when my account without wallet", () => {
    expect(() => matchAccountAuditQuery("audit my account")).toThrow("WALLET_NOT_CONNECTED");
  });

  it("uses connected address for my wallet audit", () => {
    const intent = matchAccountAuditQuery("security check my wallet", {
      connectedAddress: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
    });
    expect(intent?.method).toBe("__account_audit__");
    expect(intent?.params[0]).toBe("0xae8609a54a52501bb76c104d920efab7f52a6bcb");
  });
});

describe("executeAccountAudit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects EOA and scans chains with balance via Pocket RPC", async () => {
    const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const pocket = {
      rpc: vi.fn(async (chain: string, method: string, params?: unknown[]) => {
        if (method === "eth_getBalance") {
          if (chain === "eth") return { result: "0xde0b6b3a7640000" };
          return { result: "0x0" };
        }
        if (method === "eth_call") {
          const data = (params?.[0] as { data?: string })?.data ?? "";
          if (data.startsWith("0x70a08231")) return { result: "0x0" };
          return { result: "0x0" };
        }
        if (method === "eth_getCode") return { result: "0x" };
        if (method === "eth_getTransactionCount") return { result: "0x5" };
        if (method === "eth_blockNumber") return { result: "0x100000" };
        if (method === "eth_getLogs") return { result: [] };
        if (method === "eth_getBlockByNumber") return { result: { number: "0x100000", transactions: [] } };
        if (method === "eth_getTransactionByHash") return { result: null };
        return { result: null };
      }),
    };

    const result = await executeAccountAudit(
      pocket as unknown as import("@pokt-mcp/pocket-client").PocketClient,
      address,
      { approvalLogBlockRange: 1000, maxApprovalsPerChain: 5, activityBlockScanDepth: 10 },
    );

    expect(result.address).toBe(address);
    expect(result.primaryDataSource).toBe("pocket_network_rpc");
    expect(result.chains.some((c) => c.chain === "eth")).toBe(true);
    expect(result.chains.find((c) => c.chain === "eth")?.dataSources.activity).toBe("pocket_rpc");
    expect(result.limitations.some((l) => l.includes("Pocket Network RPC only"))).toBe(true);
  });

  it("flags unlimited approval from mocked allowance read", async () => {
    const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const maxUint = (1n << 256n) - 1n;

    const pocket = {
      rpc: vi.fn(async (chain: string, method: string, params?: unknown[]) => {
        if (method === "eth_getBalance") {
          if (chain === "eth") return { result: "0xde0b6b3a7640000" };
          return { result: "0x0" };
        }
        if (method === "eth_call") {
          const call = params?.[0] as { data?: string };
          if (call?.data?.startsWith("0x70a08231")) {
            return { result: "0x000000000000000000000000000000000000000000000000000000000005f5e100" };
          }
          if (call?.data?.startsWith("0xdd62ed3e")) {
            return { result: `0x${maxUint.toString(16)}` };
          }
          return { result: "0x0" };
        }
        if (method === "eth_getCode") return { result: "0x" };
        if (method === "eth_getTransactionCount") return { result: "0x1" };
        if (method === "eth_blockNumber") return { result: "0x100000" };
        if (method === "eth_getLogs") return { result: [] };
        if (method === "eth_getBlockByNumber") return { result: { number: "0x100000", transactions: [] } };
        if (method === "eth_getTransactionByHash") return { result: null };
        return { result: null };
      }),
    };

    const result = await executeAccountAudit(
      pocket as unknown as import("@pokt-mcp/pocket-client").PocketClient,
      address,
      { approvalLogBlockRange: 100, maxApprovalsPerChain: 3, activityBlockScanDepth: 5 },
    );

    expect(result.findings.some((f) => f.category === "unlimited_approval")).toBe(true);
    expect(result.riskLevel).toBe("high");
  });

  it("chunks approval log scans within Pocket max block range", async () => {
    const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const getLogsCalls: Array<{ fromBlock: string; toBlock: string }> = [];

    const pocket = {
      rpc: vi.fn(async (chain: string, method: string, params?: unknown[]) => {
        if (method === "eth_getBalance") {
          if (chain === "eth") return { result: "0xde0b6b3a7640000" };
          return { result: "0x0" };
        }
        if (method === "eth_call") return { result: "0x0" };
        if (method === "eth_getCode") return { result: "0x" };
        if (method === "eth_getTransactionCount") return { result: "0x1" };
        if (method === "eth_blockNumber") return { result: "0x30d40" }; // 200000
        if (method === "eth_getLogs") {
          const filter = params?.[0] as { fromBlock: string; toBlock: string };
          getLogsCalls.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
          return { result: [] };
        }
        if (method === "eth_getBlockByNumber") return { result: { number: "0x30d40", transactions: [] } };
        if (method === "eth_getTransactionByHash") return { result: null };
        return { result: null };
      }),
    };

    await executeAccountAudit(
      pocket as unknown as import("@pokt-mcp/pocket-client").PocketClient,
      address,
      { approvalLogBlockRange: 25000, activityBlockScanDepth: 2 },
    );

    expect(getLogsCalls.length).toBeGreaterThan(1);
    for (const call of getLogsCalls) {
      const from = BigInt(call.fromBlock);
      const to = BigInt(call.toBlock);
      expect(to - from).toBeLessThanOrEqual(10000n);
    }
  });

  it("collects recent txs from Pocket block scan", async () => {
    const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

    let ethBlockCalls = 0;
    const pocket = {
      rpc: vi.fn(async (chain: string, method: string) => {
        if (method === "eth_getBalance") {
          if (chain === "eth") return { result: "0xde0b6b3a7640000" };
          return { result: "0x0" };
        }
        if (method === "eth_call") return { result: "0x0" };
        if (method === "eth_getCode") return { result: "0x" };
        if (method === "eth_getTransactionCount") {
          if (chain === "eth") return { result: "0x2" };
          return { result: "0x0" };
        }
        if (method === "eth_blockNumber") return { result: "0x100002" };
        if (method === "eth_getLogs") return { result: [] };
        if (method === "eth_getBlockByNumber" && chain === "eth") {
          ethBlockCalls += 1;
          if (ethBlockCalls === 1) {
            return {
              result: {
                number: "0x100002",
                transactions: ["0xabc123"],
              },
            };
          }
          return { result: { number: "0x100001", transactions: [] } };
        }
        if (method === "eth_getBlockByNumber") return { result: { transactions: [] } };
        if (method === "eth_getTransactionByHash") {
          return {
            result: {
              hash: "0xabc123",
              from: address,
              to: "0x0000000000000000000000000000000000000001",
              value: "0xde0b6b3a7640000",
            },
          };
        }
        return { result: null };
      }),
    };

    const result = await executeAccountAudit(
      pocket as unknown as import("@pokt-mcp/pocket-client").PocketClient,
      address,
      { activityTxLimit: 3, activityBlockScanDepth: 2 },
    );

    const ethChain = result.chains.find((c) => c.chain === "eth");
    expect(ethChain?.recentTransactions?.length).toBe(1);
    expect(ethChain?.dataSources.activity).toBe("pocket_rpc");
  });
});

describe("ERC20_APPROVAL_TOPIC", () => {
  it("matches standard Approval event signature", () => {
    expect(ERC20_APPROVAL_TOPIC).toBe(
      "0x8c5be1e5ebec7d36bd18fad108ccfe36cb6985c0ef8377ccc628b1ad40bc2fd3",
    );
  });
});
