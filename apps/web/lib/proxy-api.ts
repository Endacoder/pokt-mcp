import type { NextRequest } from "next/server";

const INTERNAL_API_KEY_HEADER = "x-pokt-internal-key";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function upstreamBase(): string {
  return (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:5001").replace(/\/$/, "");
}

function upstreamKey(): string {
  return process.env.INTERNAL_API_KEY?.trim() ?? "";
}

export async function proxyToApi(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const path = pathSegments.join("/");
  const search = request.nextUrl.search;
  const target = `${upstreamBase()}/${path}${search}`;

  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers.set(name, value);
  }

  const key = upstreamKey();
  if (key) {
    headers.set(INTERNAL_API_KEY_HEADER, key);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && upstream.body) {
    const outHeaders = new Headers();
    for (const [name, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      outHeaders.set(name, value);
    }
    outHeaders.set("Cache-Control", "no-cache, no-transform");
    outHeaders.set("Connection", "keep-alive");
    outHeaders.set("X-Accel-Buffering", "no");
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  }

  return upstream;
}
