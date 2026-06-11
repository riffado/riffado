import { proxyRybbitGet } from "@/lib/rybbit/proxy";

export const dynamic = "force-dynamic";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ siteId: string }> },
) {
    const { siteId } = await params;
    return proxyRybbitGet(
        req,
        `/api/site/tracking-config/${encodeURIComponent(siteId)}`,
        {
            fallbackContentType: "application/json",
        },
    );
}
