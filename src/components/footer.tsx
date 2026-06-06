import Link from "next/link";
import { Suspense } from "react";
import { Github } from "@/components/icons/icons";
import { Logo } from "@/components/icons/logo";
import { ReportBugButton } from "@/components/report-bug-dialog";
import { UpdateBadge } from "@/components/update-badge";
import { env } from "@/lib/env";
import { APP_RELEASE_URL, APP_VERSION_TAG } from "@/lib/version";

export function Footer() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t border-border/30 bg-background/80 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-4 py-2.5 max-w-7xl">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground/50 font-mono">
                    <div className="flex items-center gap-2">
                        <Logo className="size-3.5 opacity-50" />
                        <span>
                            © {currentYear} Mesynx AI ·{" "}
                            <Link
                                href="https://www.gnu.org/licenses/agpl-3.0.html"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-muted-foreground transition-colors underline decoration-dotted underline-offset-2"
                            >
                                AGPL-3.0
                            </Link>
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        <Suspense fallback={null}>
                            <UpdateBadge />
                        </Suspense>
                        <Link
                            href={APP_RELEASE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-muted-foreground transition-colors"
                            aria-label={`Release notes for Mesynx AI ${APP_VERSION_TAG}`}
                        >
                            {APP_VERSION_TAG}
                        </Link>
                        {env.IS_HOSTED ? (
                            <Link
                                href="/changelog"
                                className="hover:text-muted-foreground transition-colors"
                            >
                                What&apos;s new
                            </Link>
                        ) : null}
                        <Link
                            href="/docs"
                            className="hover:text-muted-foreground transition-colors"
                        >
                            Docs
                        </Link>
                        <Link
                            href="https://github.com/r0073d-l053r/mesynx"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-muted-foreground transition-colors"
                            aria-label="View source code on GitHub"
                        >
                            <Github className="size-3.5" />
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
