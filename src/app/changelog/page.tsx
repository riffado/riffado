import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RIFFADO_REPO_URL } from "@/components/landing/github-stars-pill";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing-footer";
import { env } from "@/lib/env";
import {
    PUBLIC_CHANGELOG,
    type PublicChangelogItem,
    type PublicChangelogRelease,
    type PublicChangelogTag,
} from "@/lib/public-changelog";
import { cn } from "@/lib/utils";

const TECHNICAL_CHANGELOG_URL = `${RIFFADO_REPO_URL}/blob/main/CHANGELOG.md`;

export const metadata: Metadata = {
    title: "What's new — Riffado",
    description:
        "Plain-language changelog for Riffado. New features, improvements, and fixes, written for the people who use the app.",
};

/**
 * Hosted-user-facing changelog at `/changelog`.
 *
 * Hosted-only. On self-host this route redirects to the technical
 * `CHANGELOG.md` on GitHub, which is the accurate source for
 * "what's running on my box" -- the curated list here describes the
 * hosted app at the version the hosted operator chose to deploy, not
 * whatever release a self-host operator is running. A 404 would be
 * unhelpful when a perfectly good answer exists one redirect away.
 *
 * Content comes from `src/lib/public-changelog.ts`, grouped by release.
 * One section per version, newest-first.
 */
export default function ChangelogPage() {
    if (!env.IS_HOSTED) {
        redirect(TECHNICAL_CHANGELOG_URL);
    }

    const releases = [...PUBLIC_CHANGELOG].sort((a, b) =>
        b.date.localeCompare(a.date),
    );

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <LandingNav />

            <main className="flex-1">
                <section className="container mx-auto px-4 max-w-3xl pt-16 md:pt-24 pb-12">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
                        Changelog
                    </p>
                    <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-balance">
                        What&apos;s new in Riffado
                    </h1>
                    <p className="mt-4 text-lg text-muted-foreground leading-relaxed max-w-xl">
                        Updates to Riffado, in plain language. Looking for the
                        technical changelog?{" "}
                        <Link
                            href={TECHNICAL_CHANGELOG_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground hover:text-foreground/80 underline decoration-dotted underline-offset-2"
                        >
                            Read it on GitHub
                        </Link>
                        .
                    </p>
                </section>

                <section className="container mx-auto px-4 max-w-3xl pb-24 md:pb-32">
                    {releases.length === 0 ? (
                        <p className="text-muted-foreground">
                            We haven&apos;t shipped a user-visible change since
                            this page was added. Watch this space.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-16">
                            {releases.map((release) => (
                                <ReleaseSection
                                    key={release.date}
                                    release={release}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}

function formatReleaseDate(iso: string): string {
    // UTC-safe formatting -- we never want "April 15" to render as
    // "April 14" in a negative-offset locale.
    const [yearStr, monthStr, dayStr] = iso.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day))
        return iso;
    const d = new Date(Date.UTC(year, month, day));
    return d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}

/**
 * Coarse relative-time label rendered next to the absolute date.
 * Hosted users don't carry the current date in their head -- the
 * relative tag tells them at-a-glance whether a release is fresh or
 * months old. Server-computed at request time (the page is not
 * cached) so it stays roughly accurate without an additional client
 * island. Returns null if the parse fails or the date is in the
 * future, so callers can choose to render nothing in those cases.
 */
function formatRelativeTime(
    iso: string,
    now: Date = new Date(),
): string | null {
    const [yearStr, monthStr, dayStr] = iso.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day))
        return null;
    const then = Date.UTC(year, month, day);
    const diffMs = now.getTime() - then;
    if (diffMs < 0) return null;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const days = Math.floor(diffMs / DAY_MS);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
    const months = Math.floor(days / 30);
    if (months < 12)
        return months === 1 ? "1 month ago" : `${months} months ago`;
    const years = Math.floor(days / 365);
    return years === 1 ? "1 year ago" : `${years} years ago`;
}

function ReleaseSection({ release }: { release: PublicChangelogRelease }) {
    // Version numbers don't mean anything to a hosted user -- they don't
    // pick a version, they just experience the app over time. The date is
    // the user-meaningful unit, so it becomes the heading and the anchor.
    // The `version` field on the data stays for maintainer cross-reference
    // with CHANGELOG.md but is not rendered.
    const anchor = release.date;
    const relative = formatRelativeTime(release.date);
    return (
        <section id={anchor} aria-labelledby={`${anchor}-heading`}>
            <header className="mb-6 pb-3 border-b border-border/40 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2
                    id={`${anchor}-heading`}
                    className="text-xl font-semibold tracking-tight"
                >
                    <Link
                        href={`#${anchor}`}
                        className="rounded-sm hover:text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        <time dateTime={release.date}>
                            {formatReleaseDate(release.date)}
                        </time>
                    </Link>
                </h2>
                {relative ? (
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground/70">
                        {relative}
                    </span>
                ) : null}
            </header>
            <div className="flex flex-col gap-8">
                {release.items.map((item) => (
                    // Title is unique within a release; safe as a key.
                    <ChangelogItemRow key={item.title} item={item} />
                ))}
            </div>
        </section>
    );
}

function ChangelogItemRow({ item }: { item: PublicChangelogItem }) {
    return (
        <article className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <TagChip tag={item.tag} />
                <h3 className="text-lg font-semibold tracking-tight text-balance">
                    {item.title}
                </h3>
            </div>
            <p className="text-muted-foreground leading-relaxed text-pretty">
                <BodyText text={item.body} />
            </p>
            {item.link ? (
                <Link
                    href={item.link.href}
                    target={
                        item.link.href.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                        item.link.href.startsWith("http")
                            ? "noopener noreferrer"
                            : undefined
                    }
                    className="text-sm font-medium text-foreground hover:text-foreground/80 underline decoration-dotted underline-offset-2 w-fit"
                >
                    {item.link.label} →
                </Link>
            ) : null}
        </article>
    );
}

// Chip text uses `text-foreground` rather than `text-primary` on the
// "new" chip so the small (10px) label always passes WCAG AA against
// the tinted background. The orange identity stays on the bg + border.
// Same principle for `improved` / `fixed`: pigment in the surface,
// contrast in the text.
/**
 * Render an entry body, converting backtick-wrapped spans into
 * styled `<kbd>` keyboard-key chips. Author writes `` `Cmd K` `` in
 * the data file; reader sees a chip. Splits on backticks; odd-indexed
 * pieces become chips, even-indexed pieces stay as text. Unmatched
 * (odd count of backticks) gracefully renders the trailing piece as
 * plain text via the same alternation, so a missed backtick degrades
 * to text rather than swallowing the rest of the body.
 */
function BodyText({ text }: { text: string }) {
    const parts = text.split("`");
    return (
        <>
            {parts.map((part, i) =>
                i % 2 === 1 ? (
                    <KbdChip
                        // Backtick parts are short and content-stable; index key is fine.
                        // biome-ignore lint/suspicious/noArrayIndexKey: short stable list, ordering does not change between renders
                        key={i}
                    >
                        {part}
                    </KbdChip>
                ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: short stable list, ordering does not change between renders
                    <span key={i}>{part}</span>
                ),
            )}
        </>
    );
}

/**
 * Inline keyboard-key chip. Self-contained Tailwind -- the existing
 * `<Kbd>` in `command-palette-parts.tsx` is scoped to
 * `.command-palette kbd.cmd-kbd` in CSS, so it won't style anything
 * outside that surface. Matches the visual weight of inline body
 * text so the chip reads as "this is a key" without dominating the
 * sentence.
 */
function KbdChip({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="mx-0.5 inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground/85 leading-none align-baseline shadow-[inset_0_-1px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
            {children}
        </kbd>
    );
}

const TAG_STYLES: Record<PublicChangelogTag, string> = {
    new: "bg-primary/15 text-foreground border-primary/40",
    improved: "bg-foreground/5 text-foreground/80 border-border",
    fixed: "bg-foreground/5 text-muted-foreground border-border",
    // `news` is for announcements that aren't feature work (rebrand,
    // milestones, governance). Muted neutral so it doesn't outshine
    // actual feature releases.
    news: "bg-foreground/5 text-foreground/80 border-border",
};

const TAG_LABELS: Record<PublicChangelogTag, string> = {
    new: "New",
    improved: "Improved",
    fixed: "Fixed",
    news: "News",
};

function TagChip({ tag }: { tag: PublicChangelogTag }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                TAG_STYLES[tag],
            )}
        >
            {TAG_LABELS[tag]}
        </span>
    );
}
