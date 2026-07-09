import Link from "next/link";
import type { ReactNode } from "react";
import { LogoWordmark } from "@/components/icons/logo";
import { Panel } from "@/components/panel";

interface AuthChromeProps {
    /** Headline above the form. e.g. "Sign in" / "Create account". */
    title: string;
    /** Optional sub-headline. e.g. "Welcome back to Riffado." */
    subtitle?: string;
    /** The form body (fields + submit + internal nav links). */
    children: ReactNode;
}

// ---------------------------------------------------------------------------
// HostedAuthChrome
// ---------------------------------------------------------------------------
// Used when `env.IS_HOSTED=true`. Split-screen brand panel on the left,
// form on the right. Brand panel content is identical across all auth
// surfaces (login / register / forgot / reset) so the visual frame stays
// stable; only the right column changes.
//
// This is a marketing/conversion surface -- it sells the product to people
// who haven't bought in yet.
export function HostedAuthChrome({
    title,
    subtitle,
    children,
}: AuthChromeProps) {
    const bullets = [
        {
            label: "Choose your AI",
            body: "OpenAI or Groq for transcription, Anthropic and others for summaries, or Whisper running locally on your machine.",
        },
        {
            label: "Own your transcripts",
            body: "Local disk, your own cloud storage, or ours. Export anytime.",
        },
        {
            label: "Multi-device ready",
            body: "Plaud Note family today. More device support on the way.",
        },
    ];

    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            {/* Brand panel */}
            <aside className="relative hidden flex-col justify-between overflow-hidden bg-auth-brand p-12 text-auth-brand-foreground lg:flex">
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:14px_14px]"
                />
                <div className="relative">
                    <Link href="/" aria-label="Riffado">
                        <LogoWordmark className="h-9 w-auto text-auth-brand-foreground" />
                    </Link>
                </div>
                <div className="relative space-y-8">
                    <p className="max-w-md text-2xl font-semibold leading-tight tracking-tight">
                        Open-source AI transcription for the recorder you
                        already own.
                    </p>
                    <ul className="space-y-5 max-w-md">
                        {bullets.map((b) => (
                            <li key={b.label} className="flex gap-3">
                                <span
                                    aria-hidden
                                    className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-primary"
                                />
                                <div>
                                    <div className="text-sm font-semibold">
                                        {b.label}
                                    </div>
                                    <div className="text-sm text-auth-brand-foreground/70">
                                        {b.body}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
                <p className="relative text-xs text-auth-brand-foreground/50 font-mono">
                    AGPL-3.0 ·{" "}
                    <Link
                        href="https://github.com/riffado/riffado"
                        className="hover:text-auth-brand-foreground/80"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        github.com/riffado/riffado
                    </Link>
                </p>
            </aside>

            {/* Form column. In dark mode the page bg and the brand panel
                sit at nearly the same lightness (0.27 vs 0.34), so the
                two columns merge into one flat dark surface. Add a
                hairline divider, a subtle dot-grid texture, and a soft
                primary glow under the form -- all gated to `dark:` so
                light mode (already high-contrast) stays untouched. */}
            <main className="relative flex items-center justify-center overflow-hidden px-6 py-12 dark:lg:border-l dark:lg:border-border/40">
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 hidden dark:[background-image:radial-gradient(circle_at_1px_1px,var(--foreground)_1px,transparent_0)] dark:[background-size:24px_24px] dark:opacity-[0.04] dark:[mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] dark:block"
                />
                <div
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 hidden size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl dark:block"
                />
                <div className="relative z-10 w-full max-w-sm space-y-8">
                    <div className="lg:hidden">
                        <Link href="/" aria-label="Riffado">
                            <LogoWordmark className="h-8 w-auto text-foreground" />
                        </Link>
                    </div>
                    <div className="space-y-1.5">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        {subtitle ? (
                            <p className="text-sm text-muted-foreground">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                    {children}
                    <p className="text-center text-xs text-muted-foreground">
                        By continuing you agree to our{" "}
                        <Link
                            href="/terms"
                            className="underline hover:text-foreground"
                        >
                            Terms
                        </Link>{" "}
                        and{" "}
                        <Link
                            href="/privacy"
                            className="underline hover:text-foreground"
                        >
                            Privacy Policy
                        </Link>
                        .
                    </p>
                </div>
            </main>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SelfHostAuthChrome
// ---------------------------------------------------------------------------
// Used when `env.IS_HOSTED` is unset/false. The audience here is the
// operator (and maybe 1-2 invitees) of an instance they deployed
// themselves. They already know what Riffado is -- marketing copy is
// wasted space.
//
// Surfaces ONLY non-sensitive context below the card:
//   - Docs / GitHub / Discord links
//
// Explicitly NOT surfaced on this PRE-AUTH page (would leak to anyone
// scanning the internet for vulnerable instances):
//   - App version (helps attackers target known-CVE versions)
//   - APP_URL / hostname / region
//   - User count or other instance metrics
//   - SMTP / storage / AI provider state
//   - Anything sourced from the database
//
// Operational status (version, freshness, health) belongs on the
// post-auth admin dashboard, not here.
export function SelfHostAuthChrome({
    title,
    subtitle,
    children,
}: AuthChromeProps) {
    return (
        <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
            <div className="relative z-10 w-full max-w-md space-y-6">
                <div className="flex justify-center">
                    <Link href="/" aria-label="Riffado">
                        <LogoWordmark className="h-7 w-auto text-foreground" />
                    </Link>
                </div>
                <Panel className="space-y-6">
                    <div className="space-y-1.5">
                        <h1 className="text-xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        {subtitle ? (
                            <p className="text-sm text-muted-foreground">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                    {children}
                </Panel>
                <InstanceFooter />
            </div>
        </div>
    );
}

function InstanceFooter() {
    return (
        <div className="flex justify-center text-xs text-muted-foreground font-mono">
            <div className="flex items-center gap-4">
                <Link
                    href="https://riffado.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                >
                    Docs
                </Link>
                <span aria-hidden className="text-muted-foreground/40">
                    ·
                </span>
                <Link
                    href="https://github.com/riffado/riffado"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                >
                    GitHub
                </Link>
                <span aria-hidden className="text-muted-foreground/40">
                    ·
                </span>
                <Link
                    href="https://riffado.com/discord"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                >
                    Discord
                </Link>
            </div>
        </div>
    );
}
