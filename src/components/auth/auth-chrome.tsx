import Link from "next/link";
import type { ReactNode } from "react";
import { LogoWordmark } from "@/components/icons/logo";
import { Panel } from "@/components/panel";

interface AuthChromeProps {
    title: string;
    subtitle?: string;
    children: ReactNode;
}

// ---------------------------------------------------------------------------
// HostedAuthChrome — split-screen marketing layout
// ---------------------------------------------------------------------------
export function HostedAuthChrome({
    title,
    subtitle,
    children,
}: AuthChromeProps) {
    const bullets = [
        {
            label: "Choose your AI",
            body: "OpenAI or Groq for transcription, Anthropic and others for summaries — or Whisper running locally on your machine.",
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
                {/* Dot grid texture */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:18px_18px]"
                />
                {/* Subtle top glow */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 -top-32 size-[600px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
                />

                <div className="relative">
                    <Link href="/" aria-label="Mesynx AI">
                        <LogoWordmark className="h-8 w-auto text-auth-brand-foreground" />
                    </Link>
                </div>

                <div className="relative space-y-10">
                    <p className="max-w-md text-2xl font-semibold leading-tight tracking-tight">
                        Open-source AI transcription for the recorder you already own.
                    </p>
                    <ul className="space-y-6 max-w-md">
                        {bullets.map((b) => (
                            <li key={b.label} className="flex gap-4">
                                <span
                                    aria-hidden
                                    className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-primary"
                                />
                                <div>
                                    <div className="text-sm font-semibold text-auth-brand-foreground">
                                        {b.label}
                                    </div>
                                    <div className="mt-0.5 text-sm text-auth-brand-foreground/60 leading-relaxed">
                                        {b.body}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="relative text-[11px] text-auth-brand-foreground/40 font-mono">
                    AGPL-3.0 ·{" "}
                    <Link
                        href="https://github.com/mesynx-ai/mesynx-ai"
                        className="hover:text-auth-brand-foreground/70 transition-colors"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        github.com/mesynx-ai/mesynx-ai
                    </Link>
                </p>
            </aside>

            {/* Form column */}
            <main className="relative flex items-center justify-center overflow-hidden px-6 py-12 dark:lg:border-l dark:lg:border-border/30">
                {/* Dot grid */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:24px_24px] opacity-[0.5] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
                />
                {/* Ambient glow */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/6 blur-3xl dark:bg-primary/10"
                />

                <div className="relative z-10 w-full max-w-sm space-y-8">
                    <div className="lg:hidden">
                        <Link href="/" aria-label="Mesynx AI">
                            <LogoWordmark className="h-7 w-auto text-foreground" />
                        </Link>
                    </div>
                    <div className="space-y-1.5">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="text-sm text-muted-foreground">{subtitle}</p>
                        )}
                    </div>
                    {children}
                    <p className="text-center text-xs text-muted-foreground/60">
                        By continuing you agree to our{" "}
                        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground transition-colors">
                            Terms
                        </Link>{" "}
                        and{" "}
                        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground transition-colors">
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
// SelfHostAuthChrome — minimal centered card
// ---------------------------------------------------------------------------
export function SelfHostAuthChrome({
    title,
    subtitle,
    children,
}: AuthChromeProps) {
    return (
        <div className="relative flex min-h-screen items-center justify-center px-4 py-12 overflow-hidden">
            {/* Ambient glow */}
            <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/6 blur-3xl dark:bg-primary/10"
            />
            {/* Dot grid */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:28px_28px] opacity-[0.5] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
            />

            <div className="relative z-10 w-full max-w-[400px] space-y-5">
                <div className="flex justify-center">
                    <Link href="/" aria-label="Mesynx AI">
                        <LogoWordmark className="h-7 w-auto text-foreground/90" />
                    </Link>
                </div>

                <Panel className="space-y-6 shadow-xl dark:shadow-[0_0_0_1px_var(--border),0_20px_40px_oklch(0_0_0_/_0.6)]">
                    <div className="space-y-1">
                        <h1 className="text-xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="text-sm text-muted-foreground">{subtitle}</p>
                        )}
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
        <div className="flex justify-center text-[11px] text-muted-foreground/50 font-mono">
            <div className="flex items-center gap-4">
                <Link
                    href="https://mesynx-ai.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-muted-foreground transition-colors"
                >
                    Docs
                </Link>
                <span aria-hidden className="opacity-40">·</span>
                <Link
                    href="https://github.com/mesynx-ai/mesynx-ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-muted-foreground transition-colors"
                >
                    GitHub
                </Link>
                <span aria-hidden className="opacity-40">·</span>
                <Link
                    href="https://mesynx-ai.com/discord"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-muted-foreground transition-colors"
                >
                    Discord
                </Link>
            </div>
        </div>
    );
}
