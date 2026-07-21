import type { Metadata } from "next";
import Link from "next/link";
import { CopyableCommand } from "@/components/copyable-command";
import { Footer } from "@/components/footer";
import { LogoWordmark } from "@/components/icons/logo";
import { LandingFooter } from "@/components/landing-footer";
import { env } from "@/lib/env";
import { INSTALL_ONELINER, pinnedInstallCommand } from "@/lib/install-commands";
import { marketingMetadata } from "@/lib/seo/marketing-metadata";
import { APP_VERSION_TAG } from "@/lib/version";

/**
 * Public "how do I self-host this?" page. Linked from the landing
 * footer (Resources → Install script) and intended as a friendlier
 * landing than dumping `/install.sh` straight into the browser.
 *
 * Reachable in both deployment modes -- the page content is just
 * project docs that are useful to anyone considering self-host,
 * whether they found it via the hosted marketing site or via a
 * self-host operator sharing their own instance. Only the surrounding
 * footer chrome differs: hosted gets the rich `LandingFooter`
 * (matches the rest of the marketing surface); self-host gets the
 * minimal `Footer` (no marketing sitemap on a self-host instance).
 *
 * Deliberately a server component -- the only interactive bit is the
 * Copy button inside `<CopyableCommand>` (a small client island).
 * Reads `APP_VERSION_TAG` at build time so the version-pinned form
 * below always matches the running build.
 */

// force-dynamic: `env.IS_HOSTED` is the only condition this page branches
// on, and it's read at runtime -- without this, Next.js sees no dynamic
// API in use and statically prerenders the page during `next build`,
// baking in whatever IS_HOSTED evaluated to in the *build* environment
// (unset in this project's Dockerfile) rather than the real value the
// deployed container is configured with. Confirmed live on riffado.com:
// the self-host branch (plain `<Footer>`) was frozen into the cached
// static output instead of the hosted `<LandingFooter>`.
export const dynamic = "force-dynamic";

export const metadata: Metadata = marketingMetadata({
    title: "Install Riffado | Self-host in one command",
    description:
        "Self-host Riffado with a single curl command. Docker + Compose v2 required. AGPL-3.0, no telemetry, no license server.",
    path: "/install",
});

const ONE_LINER = INSTALL_ONELINER;
const PINNED_LINER = pinnedInstallCommand(APP_VERSION_TAG);

export default function InstallPage() {
    return (
        <div className="flex flex-col min-h-[100vh] bg-background text-foreground">
            <header className="border-b border-border/40">
                <div className="container mx-auto px-4 max-w-4xl flex h-16 items-center justify-between">
                    <Link
                        href="/"
                        className="flex items-center hover:opacity-80 transition-opacity"
                        aria-label="Riffado"
                    >
                        <LogoWordmark className="h-7 w-auto" />
                    </Link>
                    {/* The marketing landing only exists on hosted
                        (`/` redirects to `/login` on self-host), so
                        "Back to landing" is hosted-only chrome. Hiding
                        rather than rewriting the href -- on a
                        self-host instance there is no landing to go
                        back to. */}
                    {env.IS_HOSTED ? (
                        <Link
                            href="/#deploy"
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            ← Back to landing
                        </Link>
                    ) : null}
                </div>
            </header>

            <main className="flex-1">
                <section className="container mx-auto px-4 max-w-4xl py-16 md:py-24">
                    <div className="max-w-2xl">
                        <div className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground mb-6 font-mono">
                            Self-host
                        </div>
                        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
                            Install Riffado
                        </h1>
                        <p className="text-lg text-muted-foreground leading-relaxed">
                            One command on a machine with Docker and Compose v2.
                            The installer pulls the latest release&apos;s{" "}
                            <code className="font-mono text-foreground/80">
                                docker-compose.yml
                            </code>{" "}
                            and{" "}
                            <code className="font-mono text-foreground/80">
                                env.example
                            </code>
                            , generates secrets, starts the stack, and waits on{" "}
                            <code className="font-mono text-foreground/80">
                                /api/health
                            </code>
                            .
                        </p>
                    </div>

                    <div className="mt-10 space-y-3">
                        <div className="flex items-baseline justify-between gap-4">
                            <h2 className="text-xs font-semibold font-mono uppercase tracking-wider text-foreground/80">
                                Latest release
                            </h2>
                            <Link
                                href="/install.sh"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
                            >
                                View raw script →
                            </Link>
                        </div>
                        <CopyableCommand
                            command={ONE_LINER}
                            ariaLabel="Copy install command"
                        />
                    </div>

                    <div className="mt-8 space-y-3">
                        <h2 className="text-xs font-semibold font-mono uppercase tracking-wider text-foreground/80">
                            Pin to a specific version
                        </h2>
                        <CopyableCommand
                            command={PINNED_LINER}
                            ariaLabel="Copy version-pinned install command"
                        />
                        <p className="text-xs text-muted-foreground">
                            Replace{" "}
                            <code className="font-mono">{APP_VERSION_TAG}</code>{" "}
                            with any released tag from{" "}
                            <Link
                                href="https://github.com/riffado/riffado/releases"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
                            >
                                the releases page
                            </Link>
                            .
                        </p>
                    </div>

                    <div className="mt-16 grid gap-8 md:grid-cols-2">
                        <div className="space-y-2">
                            <h2 className="text-sm font-semibold font-mono uppercase tracking-wider text-foreground/80">
                                Requirements
                            </h2>
                            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                                <li>Linux or macOS</li>
                                <li>Docker (any modern version)</li>
                                <li>Docker Compose v2</li>
                                <li>Outbound HTTPS to GitHub</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-sm font-semibold font-mono uppercase tracking-wider text-foreground/80">
                                What the script does
                            </h2>
                            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                                <li>Verifies Docker + Compose v2</li>
                                <li>
                                    Downloads{" "}
                                    <code className="font-mono text-foreground/80">
                                        docker-compose.yml
                                    </code>{" "}
                                    + env template
                                </li>
                                <li>
                                    Generates{" "}
                                    <code className="font-mono text-foreground/80">
                                        BETTER_AUTH_SECRET
                                    </code>
                                    ,{" "}
                                    <code className="font-mono text-foreground/80">
                                        ENCRYPTION_KEY
                                    </code>
                                    ,{" "}
                                    <code className="font-mono text-foreground/80">
                                        POSTGRES_PASSWORD
                                    </code>
                                </li>
                                <li>
                                    Starts the stack, waits on{" "}
                                    <code className="font-mono text-foreground/80">
                                        /api/health
                                    </code>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="mt-12 rounded-lg border border-border bg-muted/30 p-5">
                        <h2 className="text-sm font-semibold mb-2">
                            Don&apos;t want to pipe to shell?
                        </h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Fair. Read the source at{" "}
                            <Link
                                href="https://github.com/riffado/riffado/blob/main/scripts/install.sh"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline decoration-dotted underline-offset-2 hover:text-foreground/80 transition-colors"
                            >
                                scripts/install.sh
                            </Link>{" "}
                            on GitHub, or follow the manual{" "}
                            <Link
                                href="https://github.com/riffado/riffado#self-host"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline decoration-dotted underline-offset-2 hover:text-foreground/80 transition-colors"
                            >
                                self-host instructions
                            </Link>{" "}
                            in the README. The whole project is AGPL-3.0,
                            inspect everything before you run it.
                        </p>
                    </div>
                </section>
            </main>

            {env.IS_HOSTED ? <LandingFooter /> : <Footer />}
        </div>
    );
}
