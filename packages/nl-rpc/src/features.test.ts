import { describe, expect, it } from "vitest";
import {
  isWalletHealthQuery,
  matchWalletHealthQuery,
} from "./wallet-health.js";
import { isTokenResearchQuery, matchTokenResearchQuery } from "./token-research.js";
import { isContractExplainerQuery, matchContractExplainerQuery } from "./contract-explainer.js";
import { isGovernanceQuery, matchGovernanceQuery } from "./governance.js";
import { isScamScanQuery, matchScamScanQuery } from "./scam-scan.js";
import { isDefiPositionsQuery, matchDefiPositionsQuery } from "./defi-positions.js";
import { isOperatorStatusQuery, matchOperatorStatusQuery } from "./operator-status.js";

describe("feature NL patterns", () => {
  it("matches wallet health queries", () => {
    expect(isWalletHealthQuery("wallet health for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    const intent = matchWalletHealthQuery(
      "How much gas have I spent? 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
    expect(intent?.method).toBe("__wallet_health__");
  });

  it("matches token research queries", () => {
    expect(isTokenResearchQuery("Research USDC on Ethereum")).toBe(true);
    const intent = matchTokenResearchQuery("Top holders of USDC on eth");
    expect(intent?.method).toBe("__token_research__");
  });

  it("matches contract explainer queries", () => {
    expect(isContractExplainerQuery("Explain contract 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true);
    const intent = matchContractExplainerQuery(
      "What does contract 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 do on eth?",
    );
    expect(intent?.method).toBe("__explain_contract__");
  });

  it("matches governance queries", () => {
    expect(isGovernanceQuery("Active UNI proposals")).toBe(true);
    const intent = matchGovernanceQuery("Active UNI governance proposals");
    expect(intent?.method).toBe("__governance__");
  });

  it("matches scam scan queries", () => {
    expect(isScamScanQuery("Is 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 a scam?")).toBe(true);
    const intent = matchScamScanQuery("Scan 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 before I buy");
    expect(intent?.method).toBe("__scam_scan__");
  });

  it("matches defi position queries", () => {
    expect(isDefiPositionsQuery("DeFi positions for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    expect(isDefiPositionsQuery("DeFi positions for my wallet")).toBe(true);
    const intent = matchDefiPositionsQuery("Aave health factor for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(intent?.method).toBe("__defi_positions__");
  });

  it("routes connected-wallet defi query via parse engine", async () => {
    const { createNlRpcEngine } = await import("./index.js");
    const parsed = await createNlRpcEngine({ llm: null }).parse("DeFi positions for my wallet", {
      connectedAddress: "0xB6c95ca2241000Facad83ef2B7ce4305BCae1F2f",
      defaultChain: "eth",
    });
    expect(parsed.intent.method).toBe("__defi_positions__");
  });

  it("matches operator status queries", () => {
    expect(isOperatorStatusQuery("Pocket node operator status")).toBe(true);
    const intent = matchOperatorStatusQuery("My relay counts this week");
    expect(intent?.method).toBe("__operator_status__");
  });
});
