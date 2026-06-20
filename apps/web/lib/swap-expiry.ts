export function isQuoteExpired(expiresAt: string, now = Date.now()): boolean {
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  return expiryMs <= now;
}

export function secondsUntilQuoteExpiry(expiresAt: string, now = Date.now()): number {
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return 0;
  return Math.max(0, Math.ceil((expiryMs - now) / 1000));
}
