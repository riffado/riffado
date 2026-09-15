import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { decideHostnameGate } from "@/lib/hosted/hostname-gate";

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    /* ── hostname gate (admin host isolation) ── */
    const requestHostname = (request.headers.get("host") ?? "")
        .split(":")[0]
        .toLowerCase();

    const decision = decideHostnameGate({
        requestHostname,
        pathname,
        adminHostname: env.ADMIN_HOSTNAME,
    });

    switch (decision.kind) {
        case "not-found":
            return new NextResponse(null, { status: 404 });
        case "redirect":
            return NextResponse.redirect(new URL(decision.to, request.url));
        case "next":
            break;
    }

    /* ── Admin: expose pathname to server components ── */
    if (pathname.startsWith("/admin")) {
        const headers = new Headers(request.headers);
        headers.set("x-pathname", pathname);
        return NextResponse.next({ request: { headers } });
    }

    return NextResponse.next();
}

export const config = {
    // NOTE: "js" is deliberately NOT in this extension exclusion list.
    // `/psthg/static/...` and `/psthg/array/...` serve JavaScript through
    // App Router handlers and must still hit `decideHostnameGate` when
    // ADMIN_HOSTNAME is set. `_next/static` already covers Next chunks.
    matcher: [
        "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|woff|woff2|ttf|otf|map)).*)",
    ],
};
