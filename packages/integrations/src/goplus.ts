import { createHash } from "node:crypto";
import { loadGoPlusAppKey, loadGoPlusAppSecret } from "./config.js";
import type { RiskLevel } from "./types.js";

const GOPLUS_BASE = "https://api.gopluslabs.io";

type CachedGoPlusToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedGoPlusToken | undefined;

function signGoPlusRequest(appKey: string, time: number, appSecret: string): string {
  return createHash("sha1").update(`${appKey}${time}${appSecret}`).digest("hex");
}

/** @internal test export */
export function signGoPlusRequestForTest(appKey: string, time: number, appSecret: string): string {
  return signGoPlusRequest(appKey, time, appSecret);
}

/** Obtain Bearer token via app_key + app_secret (cached until expiry). */
export async function getGoPlusAccessToken(): Promise<string | undefined> {
  const appKey = loadGoPlusAppKey();
  const appSecret = loadGoPlusAppSecret();
  if (!appKey || !appSecret) return undefined;

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) {
    return cachedToken.accessToken;
  }

  const time = Math.floor(now / 1000);
  const sign = signGoPlusRequest(appKey, time, appSecret);

  try {
    const res = await fetch(`${GOPLUS_BASE}/api/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ app_key: appKey, time, sign }),
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as {
      code?: number;
      result?: { access_token?: string; expires_in?: number };
    };

    const accessToken = json.result?.access_token;
    if (!accessToken) return undefined;

    const expiresInSec = json.result?.expires_in ?? 3600;
    cachedToken = {
      accessToken,
      expiresAtMs: now + expiresInSec * 1000,
    };
    return accessToken;
  } catch {
    return undefined;
  }
}

async function goPlusAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getGoPlusAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type GoPlusTokenSecurity = {
  isHoneypot?: string;
  isMintable?: string;
  isBlacklisted?: string;
  canTakeBackOwnership?: string;
  ownerChangeBalance?: string;
  hiddenOwner?: string;
  selfdestruct?: string;
  buyTax?: string;
  sellTax?: string;
  isOpenSource?: string;
  holderCount?: string;
  lpHolderCount?: string;
  isProxy?: string;
};

export type TokenSecurityResult = {
  address: string;
  chainId: number;
  security: GoPlusTokenSecurity;
  riskLevel: RiskLevel;
  findings: Array<{ severity: RiskLevel; message: string }>;
  available: boolean;
};

const CHAIN_ID_MAP: Record<string, number> = {
  eth: 1,
  base: 8453,
  "arb-one": 42161,
  poly: 137,
  opt: 10,
  avax: 43114,
  bsc: 56,
};

export function chainToGoPlusId(chain: string): number | undefined {
  return CHAIN_ID_MAP[chain];
}

function classifyTokenRisk(sec: GoPlusTokenSecurity): { riskLevel: RiskLevel; findings: TokenSecurityResult["findings"] } {
  const findings: TokenSecurityResult["findings"] = [];
  let score = 0;

  if (sec.isHoneypot === "1") {
    findings.push({ severity: "critical", message: "Honeypot detected — selling may be blocked" });
    score += 100;
  }
  if (sec.isMintable === "1") {
    findings.push({ severity: "high", message: "Token is mintable — supply can increase" });
    score += 40;
  }
  if (sec.canTakeBackOwnership === "1" || sec.hiddenOwner === "1") {
    findings.push({ severity: "high", message: "Owner can reclaim control or hidden owner detected" });
    score += 35;
  }
  if (sec.ownerChangeBalance === "1") {
    findings.push({ severity: "critical", message: "Owner can modify balances" });
    score += 80;
  }
  if (sec.isBlacklisted === "1") {
    findings.push({ severity: "medium", message: "Blacklist function present" });
    score += 20;
  }
  const buyTax = parseFloat(sec.buyTax ?? "0");
  const sellTax = parseFloat(sec.sellTax ?? "0");
  if (buyTax > 10 || sellTax > 10) {
    findings.push({ severity: "high", message: `High tax: buy ${buyTax}%, sell ${sellTax}%` });
    score += 30;
  } else if (buyTax > 5 || sellTax > 5) {
    findings.push({ severity: "medium", message: `Elevated tax: buy ${buyTax}%, sell ${sellTax}%` });
    score += 15;
  }
  if (sec.isOpenSource === "0") {
    findings.push({ severity: "medium", message: "Contract source not verified on GoPlus" });
    score += 15;
  }
  if (sec.selfdestruct === "1") {
    findings.push({ severity: "high", message: "Self-destruct function present" });
    score += 35;
  }

  let riskLevel: RiskLevel = "low";
  if (score >= 80) riskLevel = "critical";
  else if (score >= 40) riskLevel = "high";
  else if (score >= 15) riskLevel = "medium";

  return { riskLevel, findings };
}

export async function fetchTokenSecurity(
  chain: string,
  address: string,
): Promise<TokenSecurityResult> {
  const chainId = chainToGoPlusId(chain);
  if (!chainId) {
    return {
      address,
      chainId: 0,
      security: {},
      riskLevel: "low",
      findings: [{ severity: "low", message: "GoPlus not supported for this chain" }],
      available: false,
    };
  }

  const url = new URL(`${GOPLUS_BASE}/api/v1/token_security/` + chainId);
  url.searchParams.set("contract_addresses", address.toLowerCase());

  try {
    const headers = await goPlusAuthHeaders();
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      return {
        address,
        chainId,
        security: {},
        riskLevel: "low",
        findings: [{ severity: "low", message: "GoPlus API unavailable" }],
        available: false,
      };
    }

    const json = (await res.json()) as {
      code?: number;
      result?: Record<string, GoPlusTokenSecurity>;
    };

    const sec = json.result?.[address.toLowerCase()] ?? {};
    const { riskLevel, findings } = classifyTokenRisk(sec);

    return {
      address,
      chainId,
      security: sec,
      riskLevel,
      findings,
      available: true,
    };
  } catch {
    return {
      address,
      chainId,
      security: {},
      riskLevel: "low",
      findings: [{ severity: "low", message: "GoPlus request failed" }],
      available: false,
    };
  }
}

export async function fetchAddressSecurity(
  chain: string,
  address: string,
): Promise<{ riskLevel: RiskLevel; findings: Array<{ severity: RiskLevel; message: string }>; available: boolean }> {
  const chainId = chainToGoPlusId(chain);
  if (!chainId) {
    return { riskLevel: "low", findings: [], available: false };
  }

  const url = new URL(`${GOPLUS_BASE}/api/v1/address_security/` + chainId);
  url.searchParams.set("addresses", address.toLowerCase());

  try {
    const headers = await goPlusAuthHeaders();
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) return { riskLevel: "low", findings: [], available: false };

    const json = (await res.json()) as {
      result?: Record<string, { cybercrime?: string; money_laundering?: string; phishing_activities?: string; stealing_attack?: string }>;
    };

    const data = json.result?.[address.toLowerCase()];
    if (!data) return { riskLevel: "low", findings: [], available: true };

    const findings: Array<{ severity: RiskLevel; message: string }> = [];
    if (data.phishing_activities === "1") findings.push({ severity: "critical", message: "Associated with phishing" });
    if (data.stealing_attack === "1") findings.push({ severity: "critical", message: "Associated with stealing attacks" });
    if (data.cybercrime === "1") findings.push({ severity: "high", message: "Associated with cybercrime" });
    if (data.money_laundering === "1") findings.push({ severity: "high", message: "Associated with money laundering" });

    const riskLevel: RiskLevel =
      findings.some((f) => f.severity === "critical") ? "critical" :
      findings.some((f) => f.severity === "high") ? "high" :
      findings.length > 0 ? "medium" : "low";

    return { riskLevel, findings, available: true };
  } catch {
    return { riskLevel: "low", findings: [], available: false };
  }
}
