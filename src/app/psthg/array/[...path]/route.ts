import { proxyPosthog } from "@/lib/posthog/proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Context) {
    const { path } = await params;
    const search = new URL(req.url).search;
    return proxyPosthog(req, `/array/${path.join("/")}${search}`, true);
}
