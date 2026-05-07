import { type NextRequest, NextResponse } from "next/server";

/**
 * Strip auth-bearing request headers from the Rybbit analytics proxy
 * (`/api/_int/*`) so the upstream Rybbit instance never sees app session
 * cookies or bearer tokens. The browser sends these by default for any
 * same-origin request; without this middleware, Next's `rewrites()` would
 * forward them to Rybbit as-is.
 *
 * X-Forwarded-For / User-Agent / Accept-Language are preserved so Rybbit
 * can still derive geo, device, and language data.
 */
export function middleware(request: NextRequest) {
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    return NextResponse.next({ request: { headers } });
}

export const config = {
    matcher: "/api/_int/:path*",
};
