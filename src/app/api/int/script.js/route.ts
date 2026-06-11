import { proxyRybbitGet } from "@/lib/rybbit/proxy";

// `script.js` path is load-bearing: Rybbit derives analyticsHost via
// `src.split("/script.js")[0]`. Do not rename this segment.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    return proxyRybbitGet(req, "/api/script.js", {
        fallbackContentType: "application/javascript; charset=utf-8",
        cacheControl: "public, max-age=300, stale-while-revalidate=86400",
    });
}
