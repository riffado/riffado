import {
    fetchLatestReleaseTag,
    INSTALL_SCRIPT_HEADERS,
    renderInstallScript,
} from "@/lib/install-script";
import { APP_VERSION_TAG } from "@/lib/version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    const tag = (await fetchLatestReleaseTag()) ?? APP_VERSION_TAG;
    const script = await renderInstallScript(tag);
    return new Response(script, { headers: INSTALL_SCRIPT_HEADERS });
}
