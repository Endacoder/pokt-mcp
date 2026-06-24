import { normalizeQuery } from "./patterns.js";

export type GasAssessmentLevel = "very_low" | "low" | "normal" | "elevated" | "high";

export interface GasAssessment {
  gwei: number;
  level: GasAssessmentLevel;
  levelLabel: string;
  typicalRange: string;
  chainCategory: "eth_mainnet" | "l2" | "alt_l1" | "default";
}

const L2_SLUGS = new Set([
  "base",
  "arb-one",
  "opt",
  "op",
  "linea",
  "scroll",
  "blast",
  "zksync",
  "fraxtal",
  "metis",
  "mantle",
  "base-sepolia-testnet",
  "arb-sepolia-testnet",
  "op-sepolia-testnet",
]);

const ALT_L1_SLUGS = new Set(["poly", "avax", "bsc", "gnosis", "celo", "fantom", "moonbeam", "kava", "bera"]);

function chainCategory(chain: string): GasAssessment["chainCategory"] {
  if (chain === "eth" || chain === "eth-sepolia-testnet") return "eth_mainnet";
  if (L2_SLUGS.has(chain)) return "l2";
  if (ALT_L1_SLUGS.has(chain)) return "alt_l1";
  return "default";
}

function assessForCategory(gwei: number, category: GasAssessment["chainCategory"]): Omit<GasAssessment, "gwei" | "chainCategory"> {
  if (category === "eth_mainnet") {
    if (gwei < 1) return { level: "very_low", levelLabel: "very low", typicalRange: "5–30 gwei during normal activity" };
    if (gwei < 5) return { level: "low", levelLabel: "low", typicalRange: "5–30 gwei during normal activity" };
    if (gwei <= 30) return { level: "normal", levelLabel: "normal", typicalRange: "5–30 gwei during normal activity" };
    if (gwei <= 100) return { level: "elevated", levelLabel: "elevated", typicalRange: "5–30 gwei during normal activity" };
    return { level: "high", levelLabel: "high", typicalRange: "5–30 gwei during normal activity" };
  }

  if (category === "l2") {
    if (gwei < 0.01) return { level: "very_low", levelLabel: "very low", typicalRange: "0.01–0.5 gwei on most L2s" };
    if (gwei < 0.05) return { level: "low", levelLabel: "low", typicalRange: "0.01–0.5 gwei on most L2s" };
    if (gwei <= 1) return { level: "normal", levelLabel: "normal", typicalRange: "0.01–0.5 gwei on most L2s" };
    if (gwei <= 5) return { level: "elevated", levelLabel: "elevated", typicalRange: "0.01–0.5 gwei on most L2s" };
    return { level: "high", levelLabel: "high", typicalRange: "0.01–0.5 gwei on most L2s" };
  }

  if (category === "alt_l1") {
    if (gwei < 10) return { level: "very_low", levelLabel: "very low", typicalRange: "10–100 gwei on busy alt-L1s" };
    if (gwei < 30) return { level: "low", levelLabel: "low", typicalRange: "10–100 gwei on busy alt-L1s" };
    if (gwei <= 100) return { level: "normal", levelLabel: "normal", typicalRange: "10–100 gwei on busy alt-L1s" };
    if (gwei <= 300) return { level: "elevated", levelLabel: "elevated", typicalRange: "10–100 gwei on busy alt-L1s" };
    return { level: "high", levelLabel: "high", typicalRange: "10–100 gwei on busy alt-L1s" };
  }

  if (gwei < 0.1) return { level: "very_low", levelLabel: "very low", typicalRange: "varies by chain" };
  if (gwei < 1) return { level: "low", levelLabel: "low", typicalRange: "varies by chain" };
  if (gwei <= 30) return { level: "normal", levelLabel: "normal", typicalRange: "varies by chain" };
  if (gwei <= 100) return { level: "elevated", levelLabel: "elevated", typicalRange: "varies by chain" };
  return { level: "high", levelLabel: "high", typicalRange: "varies by chain" };
}

export function assessGasPrice(gwei: number, chain: string): GasAssessment {
  const cat = chainCategory(chain);
  const tier = assessForCategory(gwei, cat);
  return { gwei, chainCategory: cat, ...tier };
}

/** User asks whether gas is low/high, cheap/expensive, etc. */
export function wantsGasAssessment(query: string): boolean {
  const q = normalizeQuery(query);
  return (
    /\b(low|high|cheap|expensive|affordable|costly|bad|good)\b.*\b(gas|gwei|fees?)\b/.test(q) ||
    /\b(gas|gwei|fees?)\b.*\b(low|high|cheap|expensive|affordable|costly|bad|good)\b/.test(q) ||
    /\bis\s+(the\s+)?(gas|fee)\b/.test(q) ||
    /\bhow\s+(bad|good|busy)\s+is\s+(the\s+)?(gas|network)\b/.test(q) ||
    /\b(gas|fees?)\s+(right\s+now|now|today|currently)\b.*\b(low|high)\b/.test(q)
  );
}

export function formatGasAssessmentMessage(chain: string, assessment: GasAssessment): string {
  const { gwei, levelLabel, typicalRange } = assessment;
  return `Gas on ${chain} is ${levelLabel} right now at ${gwei.toFixed(2)} gwei. Typical range: ${typicalRange}.`;
}

export function gweiFromHex(hex: string): number {
  return Number(BigInt(hex)) / 1e9;
}
