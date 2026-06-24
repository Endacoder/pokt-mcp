import { getChatSession } from "@pokt-mcp/agent-orchestrator";
import { requireSessionId } from "@pokt-mcp/shared";

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function parseWalletAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return ETH_ADDRESS_RE.test(trimmed) ? trimmed : undefined;
}

export function resolveSwapWalletAddress(
  sessionIdHeader: string | undefined,
  bodyWalletAddress: unknown,
  walletSessions: Map<string, { address?: string; chainSlug?: string }>,
): string | undefined {
  const fromBody = parseWalletAddress(bodyWalletAddress);
  if (fromBody) return fromBody;

  if (!sessionIdHeader) return undefined;

  try {
    const sessionId = requireSessionId(sessionIdHeader);
    const fromWalletSession = parseWalletAddress(walletSessions.get(sessionId)?.address);
    if (fromWalletSession) return fromWalletSession;

    const fromChatSession = parseWalletAddress(getChatSession(sessionId)?.connectedAddress);
    if (fromChatSession) return fromChatSession;
  } catch {
    return undefined;
  }

  return undefined;
}
