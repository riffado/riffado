import {
    fetchLatestReleaseTag,
    INSTALL_SCRIPT_HEADERS,
    renderInstallScript,
} from "@/lib/install-script";
import { APP_VERSION_TAG } from "@/lib/version";

// Always-latest installer entry point. Shape:
//   curl -fsSL https://openplaud.com/install.sh | sh
//
// We resolve the latest published release tag from GitHub at request
// time (cached 5 min). If the GitHub API is unreachable or returns
// something we don't recognize, fall back to the version baked into
// package.json at build time so the installer never 500s.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    const tag = (await fetchLatestReleaseTag()) ?? APP_VERSION_TAG;
    const script = await renderInstallScript(tag);
    return new Response(script, { headers: INSTALL_SCRIPT_HEADERS });
}
