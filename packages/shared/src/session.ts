const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId);
}

export function requireSessionId(sessionId: string | undefined | null): string {
  const id = sessionId?.trim();
  if (!id) {
    throw new Error("SESSION_REQUIRED: sessionId is required");
  }
  if (id === "default") {
    throw new Error("SESSION_INVALID: reserved session id");
  }
  if (!isValidSessionId(id)) {
    throw new Error("SESSION_INVALID: sessionId must be a UUID");
  }
  return id;
}
