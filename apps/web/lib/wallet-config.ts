import { sessionHeaders } from "./session";

let cachedWcProjectId: string | null = null;

function buildTimeWcProjectId(): string {
  return (
    process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
    ""
  );
}

export async function getWcProjectId(): Promise<string> {
  const fromBuild = buildTimeWcProjectId();
  if (fromBuild) return fromBuild;

  if (cachedWcProjectId) return cachedWcProjectId;

  const res = await fetch("/api/wallet/config", {
    headers: sessionHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load WalletConnect config (${res.status})`);
  }

  const data = (await res.json()) as { wcProjectId?: string };
  const projectId = data.wcProjectId?.trim() ?? "";
  if (!projectId) {
    throw new Error("Set WALLETCONNECT_PROJECT_ID in the server environment");
  }

  cachedWcProjectId = projectId;
  return projectId;
}
