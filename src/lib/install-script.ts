import { readFile } from "node:fs/promises";
import path from "node:path";

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
    return script.replaceAll("{{VERSION}}", version);
}

export async function fetchLatestReleaseTag(): Promise<string | null> {
    try {
        const res = await fetch(
            "https://api.github.com/repos/riffado/riffado/releases/latest",
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
