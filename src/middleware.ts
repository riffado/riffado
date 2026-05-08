import { type NextRequest, NextResponse } from "next/server";

/**
 * Two responsibilities:
 *
 * 1. `/api/_int/*` (Rybbit analytics proxy): strip auth-bearing request
 *    headers so the upstream Rybbit instance never sees app session
 *    cookies or bearer tokens. The browser sends these by default for any
 *    same-origin request; without this middleware, Next's `rewrites()`
 *    would forward them to Rybbit as-is. X-Forwarded-For / User-Agent /
 *    Accept-Language are preserved so Rybbit can still derive geo,
 *    device, and language data.
 *
 * 2. `/admin/*`: forward the request pathname as `x-pathname` so the gated
 *    admin layout can record a per-page audit row instead of a generic
 *    `/admin` row, and so the reauth bounce can carry the originally
 *    requested URL in `?next=`. Server components don't have access to
 *    the request URL otherwise.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/api/_int/")) {
        const headers = new Headers(request.headers);
        headers.delete("cookie");
        headers.delete("authorization");
        return NextResponse.next({ request: { headers } });
    }

    if (pathname.startsWith("/admin")) {
        const headers = new Headers(request.headers);
        headers.set("x-pathname", pathname);
        return NextResponse.next({ request: { headers } });
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/api/_int/:path*", "/admin/:path*"],
};
