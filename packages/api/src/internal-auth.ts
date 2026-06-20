import type { Context, Next } from "hono";
import { INTERNAL_API_KEY_HEADER, isInternalApiKeyValid } from "@pokt-mcp/shared";

export function loadInternalAuthConfig() {
  return {
    internalApiKey: process.env.INTERNAL_API_KEY?.trim(),
    publicAppUrl: process.env.PUBLIC_APP_URL?.replace(/\/$/, ""),
  };
}

export function createInternalAuthMiddleware(config: ReturnType<typeof loadInternalAuthConfig>) {
  return async (c: Context, next: Next) => {
    if (!config.internalApiKey) {
      return next();
    }

    if (c.req.method === "GET" && c.req.path === "/health") {
      return next();
    }

    const provided = c.req.header(INTERNAL_API_KEY_HEADER);
    if (!isInternalApiKeyValid(provided, config.internalApiKey)) {
      return c.json(
        {
          error: "FORBIDDEN: direct API access is not allowed",
          code: "FORBIDDEN",
        },
        403,
      );
    }

    return next();
  };
}
