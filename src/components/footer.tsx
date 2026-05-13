import { Heart } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Github } from "@/components/icons/icons";
import { Logo } from "@/components/icons/logo";
import { UpdateBadge } from "@/components/update-badge";
import { APP_RELEASE_URL, APP_VERSION_TAG } from "@/lib/version";

export function Footer() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto px-4 py-6 max-w-7xl">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex flex-col items-center md:items-start gap-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-mono">Made with</span>
                            <Heart className="w-4 h-4 text-destructive fill-destructive animate-pulse" />
                            <span className="font-mono">for meetings</span>
                        </div>
                        <div className="flex flex-col items-center md:items-start gap-1">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground/80 font-mono">
                                <Logo className="size-4" />
                                <span>
                                    © {currentYear}{" "}
                                    <Link
                                        href="https://openplaud.com"
                                        className="text-primary hover:text-primary/80 transition-colors"
                                    >
                                        OpenPlaud
                                    </Link>
                                    . Licensed under{" "}
                                    <Link
                                        href="https://www.gnu.org/licenses/agpl-3.0.html"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-primary/80 transition-colors underline decoration-dotted underline-offset-2"
                                    >
                                        AGPL-3.0
                                    </Link>
                                    .
                                </span>
                            </div>
                            <Link
                                href="https://openplaud.com"
                                className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors font-mono"
                            >
                                openplaud.com
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-6 border-t border-border/20">
                    <div className="flex items-center justify-center gap-3">
                        <div className="flex gap-1">
                            {[...Array(3)].map((_, i) => (
                                <div
                                    // biome-ignore lint/suspicious/noArrayIndexKey: screw key
                                    key={i}
                                    className="w-1 h-1 rounded-full bg-muted-foreground/30"
                                />
                            ))}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
                            Open Source • Built for the Community
                        </div>
                        <Link
                            href="https://github.com/openplaud/openplaud"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                            aria-label="View source code on GitHub"
                        >
                            <Github className="size-4 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                        </Link>
                        <Link
                            href={APP_RELEASE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono uppercase tracking-wider"
                            aria-label={`Release notes for OpenPlaud ${APP_VERSION_TAG}`}
                        >
                            {APP_VERSION_TAG}
                        </Link>
                        {/* Self-host-only update notice. Suspended with a null
                            fallback so a cold GitHub-API cache doesn't block
                            the rest of the footer from streaming. */}
                        <Suspense fallback={null}>
                            <UpdateBadge />
                        </Suspense>
                        <div className="flex gap-1">
                            {[...Array(3)].map((_, i) => (
                                <div
                                    // biome-ignore lint/suspicious/noArrayIndexKey: screw key
                                    key={i}
                                    className="w-1 h-1 rounded-full bg-muted-foreground/30"
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}
