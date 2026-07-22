import { proxyPosthog } from "@/lib/posthog/proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Context) {
    const { path } = await params;
    const search = new URL(req.url).search;
    return proxyPosthog(req, `/${path.join("/")}${search}`, false);
}

export const GET = handle;
export const POST = handle;
