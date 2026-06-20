/** Resolve API base URL safe for browser (never docker-internal or bare localhost in prod). */
export function getApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? "/api";

  if (typeof window === "undefined") {
    return configured;
  }

  // Relative paths always work behind reverse proxy / Cloudflare tunnel.
  if (configured.startsWith("/")) {
    return configured;
  }

  try {
    const url = new URL(configured);
    const host = url.hostname;
    if (isBlockedBrowserHost(host)) {
      return "/api";
    }
    return configured;
  } catch {
    return "/api";
  }
}

function isBlockedBrowserHost(host: string): boolean {
  if (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "api" ||
    host === "host.docker.internal"
  ) {
    return true;
  }

  // Private / link-local IPs are unreachable from public browsers.
  if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true;
  }
  if (host.endsWith(".local")) {
    return true;
  }

  return false;
}

export function isLocalBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** True when a URL points at the user's machine / LAN (invalid from https://pokt.metalift.ai). */
export function isLocalOnlyUrl(raw: string): boolean {
  if (raw.startsWith("/")) return false;
  try {
    const url = new URL(raw);
    return isBlockedBrowserHost(url.hostname);
  } catch {
    return true;
  }
}

export function isSseUrlAllowedInBrowser(raw: string): boolean {
  if (!raw.trim()) return false;
  if (raw.startsWith("/")) return true;
  if (typeof window === "undefined") return true;
  if (isLocalBrowser()) return true;
  return !isLocalOnlyUrl(raw);
}

export function defaultMcpSseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MCP_SSE_URL?.trim();
  if (configured) {
    return isSseUrlAllowedInBrowser(configured) ? configured : "";
  }
  return isLocalBrowser() ? "http://127.0.0.1:3002/sse" : "";
}
