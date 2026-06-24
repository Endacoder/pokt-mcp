import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  executeWalletHealth,
  executeTokenResearch,
  executeContractExplainer,
  executeGovernance,
  executeScamScan,
  executeDefiPositions,
  executeOperatorStatus,
} from "@pokt-mcp/nl-rpc";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { asToolServer, READ_ONLY_ANNOTATION, textResult } from "./helpers.js";

interface FeatureToolDeps {
  pocket: PocketClient;
}

export function registerFeatureTools(server: McpServer, deps: FeatureToolDeps) {
  const s = asToolServer(server);

  s.tool(
    "pocket_wallet_health",
    "Wallet health check: health score, gas fees spent, token history, portfolio, and approval risks in plain English.",
    {
      address: z.string().describe("EVM wallet address or ENS name"),
    },
    async ({ address }) => {
      try {
        const result = await executeWalletHealth(deps.pocket, address);
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_research_token",
    "Token research: spot price, volume trends, top holders, and safety preview for a token on a chain.",
    {
      query: z.string().describe("Natural language token research query"),
      chain: z.string().optional().default("eth").describe("Chain slug"),
      token: z.string().optional().describe("Token symbol or contract address"),
    },
    async ({ query, chain, token }) => {
      try {
        const result = await executeTokenResearch(deps.pocket, query, chain, token ?? "");
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_explain_contract",
    "Smart contract explainer: verified source, proxy detection, function summary, and suspicious pattern flags.",
    {
      chain: z.string().describe("Chain slug"),
      address: z.string().describe("Contract address"),
    },
    async ({ chain, address }) => {
      try {
        const result = await executeContractExplainer(deps.pocket, chain, address);
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_governance_query",
    "DAO & governance tracker: active proposals, voting history, and whale votes via Snapshot.",
    {
      query: z.string().describe("Governance query e.g. 'active UNI proposals' or 'whale votes on latest Aave proposal'"),
      space: z.string().optional().describe("Snapshot space id e.g. uniswap"),
      mode: z.enum(["proposals", "votes", "whales", "voter_history"]).optional().default("proposals"),
    },
    async ({ query, space, mode }) => {
      try {
        const result = await executeGovernance(query, space ?? "", mode);
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_scan_address",
    "Rug pull / scam detector: scan a wallet or contract for honeypot, approval, and reputation risks.",
    {
      chain: z.string().describe("Chain slug"),
      address: z.string().describe("Wallet or contract address to scan"),
    },
    async ({ chain, address }) => {
      try {
        const result = await executeScamScan(deps.pocket, chain, address);
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_defi_positions",
    "DeFi position monitor: indexed positions, total TVL, and Aave health factor / liquidation risk.",
    {
      chain: z.string().describe("Chain slug for protocol reads"),
      address: z.string().describe("Wallet address"),
    },
    async ({ chain, address }) => {
      try {
        const result = await executeDefiPositions(deps.pocket, chain, address);
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );

  s.tool(
    "pocket_operator_status",
    "Pocket node operator dashboard: supplier status, services, stake, relay mining difficulty, and optional Prometheus metrics.",
    {
      supplierAddress: z.string().optional().describe("Pocket supplier address (pokt1…) or set POCKET_OPERATOR_ADDRESS"),
    },
    async ({ supplierAddress }) => {
      try {
        const result = await executeOperatorStatus(supplierAddress ?? "", "operator status");
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
    READ_ONLY_ANNOTATION,
  );
}
