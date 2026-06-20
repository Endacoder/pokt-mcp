import { NextRequest, NextResponse } from "next/server";
import { isTokenExemptPath, validateBrowserSessionToken } from "./lib/session-auth";

const APP_ORIGIN = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");

function forbidden(message: string) {
  return NextResponse.json({ error: message, code: "FORBIDDEN" }, { status: 403 });
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (APP_ORIGIN) {
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (!isTokenExemptPath(pathname, request.method)) {
      if (!secFetchSite || secFetchSite === "none") {
        return forbidden("API is only available from the web app");
      }
      if (secFetchSite === "cross-site") {
        return forbidden("Cross-origin API access is not allowed");
      }
      const origin = request.headers.get("origin");
      if (origin && origin !== APP_ORIGIN) {
        return forbidden("Invalid origin");
      }
    } else if (request.method === "POST" && pathname === "/api/session/token") {
      if (!secFetchSite || secFetchSite === "none" || secFetchSite === "cross-site") {
        return forbidden("Session tokens can only be issued from the web app");
      }
    }
  }

  if (!(await validateBrowserSessionToken(request))) {
    return unauthorized("Invalid or missing session token");
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
