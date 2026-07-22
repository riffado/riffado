import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Same-origin reverse proxy for the client PostHog SDK (`api_host: "/psthg"`
 * in `posthog-init.tsx`). Mirrors `src/lib/rybbit/proxy.ts`'s pattern:
 * a route handler, not a `next.config.ts` static rewrite, specifically
 * because rewrites are resolved once at `next build` time and baked into
 * the shared standalone image -- they can't gate on `IS_HOSTED` or read
 * `POSTHOG_HOST` at container runtime. A route handler runs per-request,
 * so both the hosted gate and the destination host are always current.
 */

const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

function gated(): { ok: false; res: NextResponse } | { ok: true } {
    if (!env.IS_HOSTED || !env.POSTHOG_KEY) {
        return {
            ok: false,
            res: new NextResponse("Not found", { status: 404 }),
        };
    }
    return { ok: true };
}

function upstreamUrl(path: string, assets: boolean): string {
    const host = (env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST).replace(/\/$/, "");
    const base = assets
        ? host.replace(".i.posthog.com", "-assets.i.posthog.com")
        : host;
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
}

/**
 * Proxy a single request to PostHog. `assets` selects the `-assets.`
 * ingest subdomain (static/array bundles) vs the main ingest host
 * (capture/decide/flags/session-replay).
 */
export async function proxyPosthog(
    req: Request,
    upstreamPath: string,
    assets: boolean,
): Promise<NextResponse> {
    const gate = gated();
    if (!gate.ok) return gate.res;

    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const ua = req.headers.get("user-agent");
    if (ua) headers.set("User-Agent", ua);

    const method = req.method.toUpperCase();
    const body =
        method === "GET" || method === "HEAD"
            ? undefined
            : await req.arrayBuffer();

    let upstreamRes: Response;
    try {
        upstreamRes = await fetch(upstreamUrl(upstreamPath, assets), {
            method,
            headers,
            body,
            cache: "no-store",
        });
    } catch {
        return new NextResponse("Bad gateway", { status: 502 });
    }
    if (!upstreamRes.body) {
        return new NextResponse(null, { status: upstreamRes.status });
    }

    const resHeaders = new Headers();
    const ct = upstreamRes.headers.get("content-type");
    if (ct) resHeaders.set("Content-Type", ct);

    return new NextResponse(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders,
    });
}
