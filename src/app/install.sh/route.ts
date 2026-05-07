import {
    fetchLatestReleaseTag,
    INSTALL_SCRIPT_HEADERS,
    renderInstallScript,
} from "@/lib/install-script";
import packageJson from "../../../package.json" with { type: "json" };

// Always-latest installer entry point. Shape:
//   curl -fsSL https://openplaud.com/install.sh | sh
//
// We resolve the latest published release tag from GitHub at request
// time (cached 5 min). If the GitHub API is unreachable or returns
// something we don't recognize, fall back to the version baked into
// package.json at build time so the installer never 500s.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FALLBACK_VERSION = `v${packageJson.version}`;

export async function GET() {
    const tag = (await fetchLatestReleaseTag()) ?? FALLBACK_VERSION;
    const script = await renderInstallScript(tag);
    return new Response(script, { headers: INSTALL_SCRIPT_HEADERS });
}
