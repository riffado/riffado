import { proxyRybbitGet } from "@/lib/rybbit/proxy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    return proxyRybbitGet(req, "/api/replay.js", {
        fallbackContentType: "application/javascript; charset=utf-8",
        cacheControl: "public, max-age=300, stale-while-revalidate=86400",
    });
}
