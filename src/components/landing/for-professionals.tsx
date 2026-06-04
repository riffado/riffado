import { ArrowRight, Github } from "lucide-react";
import Link from "next/link";

export function ForProfessionals() {
    return (
        <section
            id="for-professionals"
            className="py-20 bg-secondary/20 border-y border-border/40"
        >
            <div className="container mx-auto px-4">
                <div className="max-w-5xl mx-auto">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono uppercase tracking-wider mb-4 text-muted-foreground">
                        <span>For professionals</span>
                        <span aria-hidden className="text-muted-foreground/40">
                            {"//"}
                        </span>
                        <span className="text-muted-foreground/80">
                            Lawyers · Journalists · Consultants · Researchers
                        </span>
                    </div>

                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-8 max-w-3xl">
                        If your conversations stay in the room, your recordings
                        should too.
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-8 mb-10">
                        <Pillar
                            kicker="01 / Infrastructure"
                            headline="Runs where you put it."
                            body="Local disk, your own S3 bucket, or our hosted tier. Recordings sit on storage you control."
                        />
                        <Pillar
                            kicker="02 / Source"
                            headline="Auditable, line by line."
                            body="Every line of Mesynx AI is AGPL-3.0. Read it, fork it, show clients exactly what it does."
                        />
                        <Pillar
                            kicker="03 / AI"
                            headline="Yours, including local."
                            body="Run Whisper locally via Ollama — recordings never leave the machine. Or plug in any OpenAI-compatible cloud."
                        />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/docs/self-hosting"
                                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium"
                            >
                                Read the self-host guide
                                <ArrowRight className="size-4" />
                            </Link>
                            <Link
                                href="https://github.com/mesynx-ai/mesynx-ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border border-border bg-background hover:bg-secondary/40 transition-colors text-sm font-medium"
                            >
                                <Github className="size-4" />
                                Read the source
                            </Link>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            Need an air-gapped or in-house setup? Write to{" "}
                            <Link
                                href="mailto:support@mesynx-ai.com?subject=In-house%20Mesynx AI%20setup"
                                className="text-foreground font-medium hover:text-primary transition-colors underline-offset-4 hover:underline"
                            >
                                support@mesynx-ai.com
                            </Link>{" "}
                            — I'll reply personally.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

function Pillar({
    kicker,
    headline,
    body,
}: {
    kicker: string;
    headline: string;
    body: string;
}) {
    return (
        <div className="space-y-2">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {kicker}
            </p>
            <h3 className="text-base font-semibold leading-snug">{headline}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
                {body}
            </p>
        </div>
    );
}
