import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing-footer";

export const metadata: Metadata = {
    title: "OpenPlaud is now Riffado | Read the rebrand note",
    description:
        "Same team. Same code. New name. Here's why we renamed and what doesn't change for you.",
};

/**
 * Public rebrand explainer.
 *
 * Single source of truth for "why the name change" -- linked from the
 * landing announcement bar, the in-app banner, the `/changelog` entry,
 * and (operationally) the `openplaud.com` redirect.
 *
 * Rendered for everyone, including self-host. This is a one-time-event
 * note about an action the project took, not about the state of the
 * hosted service -- a self-host operator visiting `/rebrand` gets the
 * same accurate story as a hosted user.
 *
 * Tone matches `for-professionals.tsx` ("I'll reply personally"): the
 * project speaks with a personal voice from its maintainer, not as a
 * faceless team. Structure leads with rumor-killing ("not a buyout"),
 * then the story (why), then the practical reassurance (what stays).
 * Signed by name to cash the trust check.
 */
export default function RebrandPage() {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <LandingNav />

            <main className="flex-1">
                <article className="container mx-auto px-4 max-w-3xl pt-16 md:pt-24 pb-24 md:pb-32">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
                        May 29, 2026
                    </p>
                    <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-balance">
                        OpenPlaud is now Riffado.
                    </h1>
                    <p className="mt-4 text-lg text-muted-foreground leading-relaxed max-w-xl text-pretty">
                        Same team. Same code. Bigger horizon.
                    </p>

                    <section className="mt-12 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            Not a buyout. Not an acquisition. Not a fork.
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Nobody bought us. Nobody acquired us. The project
                            did not change hands, the source did not fork, and
                            the license is still AGPL-3.0. The legal entity
                            behind Riffado is the same as the legal entity
                            behind OpenPlaud yesterday. If anyone tells you
                            otherwise, they&apos;re wrong.
                        </p>
                    </section>

                    <section className="mt-10 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            Why the name
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            &quot;OpenPlaud&quot; tied the project to one
                            vendor. Plaud Note is the device family we support
                            today and that isn&apos;t changing &mdash; sync,
                            transcription, and everything else continues to work
                            exactly the way it did yesterday. But the roadmap
                            has always been broader than one recorder, and every
                            conversation about it started with the same
                            question: &quot;is this only for Plaud?&quot; The
                            old name kept boxing us in. Riffado is a name we can
                            grow into without explaining a contradiction.
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                            We&apos;re giving up the &quot;Open&quot; in the
                            wordmark, not in the source. The code is still
                            AGPL-3.0 on GitHub; the badge stays where it
                            matters. We just stopped putting it in the name.
                        </p>
                    </section>

                    <section className="mt-10 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            Nothing about your account changes
                        </h2>
                        <ul className="text-muted-foreground leading-relaxed space-y-2 list-disc pl-5">
                            <li>
                                Your hosted account, recordings, transcripts,
                                summaries, and settings are exactly where you
                                left them.
                            </li>
                            <li>Same prices. Same free tier. No new gates.</li>
                            <li>
                                Same self-host install command. Same Docker
                                stack. Same environment variables.
                            </li>
                            <li>
                                Same people building it. Same governance. Same
                                maintainers.
                            </li>
                        </ul>
                    </section>

                    <section className="mt-10 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            Your API tokens still work
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Tokens that start with{" "}
                            <span className="font-mono text-foreground/90">
                                op_
                            </span>{" "}
                            keep authenticating. If we ever issue new-format
                            tokens, the old ones stay valid. You don&apos;t need
                            to rotate anything in n8n, Zapier, your scripts, or
                            anywhere else you&apos;ve pasted a key.
                        </p>
                    </section>

                    <section className="mt-10 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            For self-hosters
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            The repo moved to{" "}
                            <Link
                                href="https://github.com/riffado/riffado"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline decoration-dotted underline-offset-2 hover:text-foreground/80"
                            >
                                github.com/riffado/riffado
                            </Link>
                            ; GitHub redirects the old URL automatically. No env
                            vars renamed, no Docker images renamed, no migration
                            to run. Existing instances need no action.
                        </p>
                    </section>

                    <section className="mt-10 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight">
                            If anything broke for you
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Write to{" "}
                            <Link
                                href="mailto:support@riffado.com?subject=Rebrand%20issue"
                                className="text-foreground underline decoration-dotted underline-offset-2 hover:text-foreground/80"
                            >
                                support@riffado.com
                            </Link>{" "}
                            and I&apos;ll fix it.
                        </p>
                    </section>

                    <p className="mt-16 text-base text-foreground">
                        &mdash; Kacper, from Riffado
                    </p>

                    <p className="mt-12 text-sm">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="size-3.5" aria-hidden />
                            Back to riffado.com
                        </Link>
                    </p>
                </article>
            </main>

            <LandingFooter />
        </div>
    );
}
