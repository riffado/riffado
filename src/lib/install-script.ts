import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Loads `scripts/install.sh` from disk and substitutes `{{VERSION}}` with
 * the requested version tag. Source of truth is the file in the repo —
 * both `/install.sh` and `/[version]/install.sh` route through this.
 *
 * The standalone Next.js output excludes files outside the build graph,
 * so `next.config.ts` declares `outputFileTracingIncludes` for both
 * routes pointing at `scripts/install.sh`. Without that, this read fails
 * at runtime in the Docker image.
 */

const VERSION_RE = /^v\d+\.\d+\.\d+$/;

let cachedScript: string | null = null;

async function loadScript(): Promise<string> {
    if (cachedScript !== null) return cachedScript;
    const scriptPath = path.join(process.cwd(), "scripts", "install.sh");
    cachedScript = await readFile(scriptPath, "utf-8");
    return cachedScript;
}

export function isValidVersionTag(value: string): boolean {
    return VERSION_RE.test(value);
}

export async function renderInstallScript(version: string): Promise<string> {
    const script = await loadScript();
    // Replace every occurrence of the placeholder so the rendered script
    // can reference the version more than once if we ever need to.
    return script.replaceAll("{{VERSION}}", version);
}

/**
 * Resolve the latest release tag from GitHub. Cached at the fetch layer
 * for 5 minutes so we don't blow through the unauthenticated 60 req/hr
 * rate limit on the API.
 *
 * Falls back to `null` on any failure — callers should substitute a
 * sensible default (e.g. the version baked into package.json at build
 * time) rather than 500.
 */
export async function fetchLatestReleaseTag(): Promise<string | null> {
    try {
        const res = await fetch(
            "https://api.github.com/repos/openplaud/openplaud/releases/latest",
            {
                headers: {
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                next: { revalidate: 300 },
            },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { tag_name?: unknown };
        const tag = typeof data.tag_name === "string" ? data.tag_name : null;
        if (tag && isValidVersionTag(tag)) return tag;
        return null;
    } catch {
        return null;
    }
}

export const INSTALL_SCRIPT_HEADERS: Record<string, string> = {
    "Content-Type": "text/x-shellscript; charset=utf-8",
    "Cache-Control": "public, max-age=60, s-maxage=300",
    "X-Content-Type-Options": "nosniff",
};
