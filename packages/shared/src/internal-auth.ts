import { timingSafeEqual } from "node:crypto";

export const INTERNAL_API_KEY_HEADER = "x-pokt-internal-key";

export function isInternalApiKeyConfigured(expected: string | undefined): boolean {
  return Boolean(expected?.trim());
}

export function isInternalApiKeyValid(
  provided: string | undefined | null,
  expected: string | undefined,
): boolean {
  const secret = expected?.trim();
  if (!secret) return true;
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
