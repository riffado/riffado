import { Star } from "lucide-react";
import { Github } from "@/components/icons/icons";

export const RIFFADO_REPO = "riffado/riffado";
export const RIFFADO_REPO_URL = `https://github.com/${RIFFADO_REPO}`;

/**
 * Fetch the live GitHub star count for the Riffado repo.
 *
 * Runtime fetch, cached for 1 hour via Next.js ISR. Visitors always see a
 * pre-rendered page; the first request after expiry triggers a background
 * revalidation. GitHub's unauthenticated rate limit (60/hr per IP) is a
 * non-issue because only our server ever hits it, at most ~24×/day.
 *
 * Exported so multiple landing components (nav pill, hero trust row) share
 * the same ISR-cached fetch instead of issuing duplicate GitHub requests.
 */
export async function fetchStarCount(): Promise<number | null> {
    try {
        const res = await fetch(
            `https://api.github.com/repos/${RIFFADO_REPO}`,
            {
                next: { revalidate: 3600 },
                headers: { Accept: "application/vnd.github+json" },
            },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { stargazers_count?: number };
        return typeof data.stargazers_count === "number"
            ? data.stargazers_count
            : null;
    } catch {
        return null;
    }
}

/** Format a star count compactly: 1234 → "1.2k", 12345 → "12.3k". */
export function formatStars(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString("en-US");
}

export async function GitHubStarsPill() {
    const stars = await fetchStarCount();
    const label =
        stars === null
            ? "Star on GitHub"
            : `${formatStars(stars)} stars on GitHub`;

    return (
        <a
            href={RIFFADO_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="group hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-background/60 pl-3 pr-3.5 h-9 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background hover:border-foreground/20 transition-colors"
        >
            <Github className="size-4" />
            <span className="h-4 w-px bg-border group-hover:bg-foreground/20 transition-colors" />
            <Star className="size-3.5 fill-current text-amber-500" />
            {stars === null ? (
                <span>Star</span>
            ) : (
                <span className="tabular-nums">{formatStars(stars)}</span>
            )}
        </a>
    );
}
