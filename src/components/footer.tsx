import Link from "next/link";
import { Suspense } from "react";
import { Github } from "@/components/icons/icons";
import { Logo } from "@/components/icons/logo";
import { ReportBugButton } from "@/components/report-bug-dialog";
import { UpdateBadge } from "@/components/update-badge";
import { env } from "@/lib/env";
import { APP_RELEASE_URL, APP_VERSION_TAG } from "@/lib/version";

/**
 * In-app footer rendered on every signed-in screen via
 * `src/app/(app)/layout.tsx`. Kept deliberately minimal -- this is
 * chrome that ships under every workstation, dashboard, and settings
 * pane, so weight here is paid for on every view.
 *
 * Also mounted on `/install` when `!env.IS_HOSTED` -- on a self-host
 * instance the install page is reachable but the marketing-sitemap
 * `LandingFooter` would be dishonest chrome (no "Pricing" or "For
 * Professionals" surface exists), so the page falls back to this
 * minimal footer.
 *
 * The richer marketing footer lives in `landing-footer.tsx` and is
 * mounted on `/`, `/install` (hosted branch), and the `(legal)` layout.
 *
 * Server component so it can read `env.IS_HOSTED` directly -- hosted
 * gets a support link, self-host gets the update badge. Neither side
 * sees both. PR #124 already dropped the original `"use client"`.
 */
export function Footer() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-4 py-3 max-w-7xl">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
                    <div className="flex items-center gap-2">
                        <Logo className="size-4" />
                        <span>
                            © {currentYear} Riffado · Licensed under{" "}
                            <Link
                                href="https://www.gnu.org/licenses/agpl-3.0.html"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                            >
                                AGPL-3.0
                            </Link>
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Self-host-only update notice. Suspended with a
                            null fallback so a cold GitHub-API cache
                            doesn't block the rest of the footer from
                            streaming. UpdateBadge already no-ops on
                            hosted -- the Suspense is for the network
                            fetch, not the gate. */}
                        <Suspense fallback={null}>
                            <UpdateBadge />
                        </Suspense>
                        <Link
                            href={APP_RELEASE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-foreground transition-colors"
                            aria-label={`Release notes for Riffado ${APP_VERSION_TAG}`}
                        >
                            {APP_VERSION_TAG}
                        </Link>
                        {/* Hosted-only "What's new" link to the public,
                            plain-language changelog. Self-host already
                            has the version tag above which points at
                            the GitHub release notes, so adding it
                            there would just duplicate the entry point. */}
                        {env.IS_HOSTED ? (
                            <Link
                                href="/changelog"
                                className="hover:text-foreground transition-colors"
                            >
                                What&apos;s new
                            </Link>
                        ) : null}
                        <Link
                            href="/docs"
                            className="hover:text-foreground transition-colors"
                        >
                            Docs
                        </Link>
                        {/* Single bug-report entry point for both modes.
                            Self-host → GitHub-only dialog. Hosted →
                            GitHub + mailto. Replaces the old
                            hosted-only "Support" mailto link — hosted
                            users now get the same dialog with the
                            mailto button included inside it, and self-
                            hosters get a proper reporting path that
                            previously didn't exist. */}
                        <ReportBugButton
                            isHosted={env.IS_HOSTED}
                            className="hover:text-foreground transition-colors"
                        />
                        <Link
                            href="https://github.com/riffado/riffado"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-foreground transition-colors"
                            aria-label="View source code on GitHub"
                        >
                            <Github className="size-4" />
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
