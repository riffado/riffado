import { proxyRybbitPost } from "@/lib/rybbit/proxy";

export const dynamic = "force-dynamic";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ siteId: string }> },
) {
    const { siteId } = await params;
    return proxyRybbitPost(
        req,
        `/api/session-replay/record/${encodeURIComponent(siteId)}`,
    );
}
