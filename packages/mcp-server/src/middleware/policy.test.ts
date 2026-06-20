import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPolicyConfig,
  assertWritePolicy,
  assertMethodAllowed,
} from "./policy.js";
import { writeAudit } from "./audit.js";

describe("policy", () => {
  it("denies over-limit send value", () => {
    const config = loadPolicyConfig();
    config.maxSendValueEth = 0.01;
    expect(() =>
      assertWritePolicy(config, {
        chain: "eth",
        value: `0x${BigInt(Math.floor(0.02 * 1e18)).toString(16)}`,
      }),
    ).toThrow(/POLICY_DENIED/);
  });

  it("denies disallowed chain", () => {
    const config = loadPolicyConfig();
    config.allowedChains = new Set(["eth"]);
    expect(() => assertWritePolicy(config, { chain: "bsc", value: "0x0" })).toThrow(/POLICY_DENIED/);
  });

  it("denies denylisted method", () => {
    const config = loadPolicyConfig();
    expect(() => assertMethodAllowed(config, "eth_sign")).toThrow(/POLICY_DENIED/);
  });

  it("allows read methods not on denylist", () => {
    const config = loadPolicyConfig();
    expect(() => assertMethodAllowed(config, "eth_blockNumber")).not.toThrow();
  });
});

describe("audit", () => {
  it("appends JSON line to audit log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pokt-audit-"));
    process.env.POKT_AUDIT_DIR = dir;
    await writeAudit({
      timestamp: new Date().toISOString(),
      tool: "wallet_send_transaction",
      chain: "eth",
      status: "submitted",
      txHash: "0xabc",
    });
    const content = await readFile(join(dir, "audit.log"), "utf8");
    expect(content).toContain("wallet_send_transaction");
    expect(content).toContain("0xabc");
    delete process.env.POKT_AUDIT_DIR;
  });
});
