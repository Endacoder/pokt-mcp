import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeAccountAudit } from "@pokt-mcp/nl-rpc";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { asToolServer, READ_ONLY_ANNOTATION, textResult } from "./helpers.js";

interface AuditToolDeps {
  pocket: PocketClient;
}

export function registerAuditTools(server: McpServer, deps: AuditToolDeps) {
  const s = asToolServer(server);

  s.tool(
    "pocket_audit_account",
    "Multi-chain security audit via Pocket Network RPC: portfolio, recent activity (block scan), and token approvals across Pocket EVM mainnets.",
    {
      address: z.string().describe("EVM address to audit (use wallet_get_status for connected address)"),
      activityTxLimit: z
        .number()
        .optional()
        .default(5)
        .describe("Max recent native txs per active chain (Pocket block scan)"),
      activityBlockScanDepth: z
        .number()
        .optional()
        .default(150)
        .describe("Blocks to scan via Pocket eth_getBlockByNumber for recent txs"),
      approvalLogBlockRange: z
        .number()
        .optional()
        .default(50000)
        .describe("Block range for Approval event log scan via Pocket eth_getLogs"),
      maxApprovalsPerChain: z
        .number()
        .optional()
        .default(25)
        .describe("Max allowance checks per chain"),
      scanKnownTokens: z
        .boolean()
        .optional()
        .default(true)
        .describe("Scan KNOWN_TOKENS registry balances via Pocket eth_call"),
    },
    async ({
      address,
      activityTxLimit,
      activityBlockScanDepth,
      approvalLogBlockRange,
      maxApprovalsPerChain,
      scanKnownTokens,
    }) => {
      try {
        const result = await executeAccountAudit(deps.pocket, address, {
          activityTxLimit,
          activityBlockScanDepth,
          approvalLogBlockRange,
          maxApprovalsPerChain,
          scanKnownTokens,
        });
        return textResult({
          summary: result.summary,
          primaryDataSource: result.primaryDataSource,
          riskLevel: result.riskLevel,
          address: result.address,
          scannedChains: result.scannedChains,
          activeChains: result.activeChains,
          portfolio: result.portfolio,
          chains: result.chains,
          findings: result.findings,
          limitations: result.limitations,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );
}
