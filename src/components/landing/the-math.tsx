export function TheMath() {
    return (
        <section className="py-24 border-y border-border/40 bg-secondary/10">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                        Here's what you're actually paying for.
                    </h2>
                    <p className="text-muted-foreground text-lg leading-relaxed mb-12">
                        Plaud doesn't transcribe your audio. OpenAI, Groq, and
                        similar do. Plaud marks it up and wraps a subscription
                        around it. OpenPlaud lets you pay the provider directly.
                    </p>

                    <div className="rounded-2xl border border-border bg-card overflow-hidden">
                        <div className="flex items-baseline justify-between gap-6 p-6 md:p-8 border-b border-border">
                            <div>
                                <div className="text-sm font-medium text-muted-foreground mb-1">
                                    Plaud Pro
                                </div>
                                <div className="text-xs text-muted-foreground/80">
                                    1,200 minutes of transcription per month
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-4xl md:text-5xl font-bold tracking-tight tabular-nums">
                                    $17.99
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    every month
                                </div>
                            </div>
                        </div>

                        <div className="flex items-baseline justify-between gap-6 p-6 md:p-8 border-b border-border">
                            <div>
                                <div className="text-sm font-medium mb-1">
                                    OpenPlaud{" "}
                                    <span className="text-muted-foreground font-normal">
                                        + OpenAI Whisper
                                    </span>
                                </div>
                                <div className="text-xs text-muted-foreground/80">
                                    Same 1,200 minutes, paid to OpenAI directly
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums">
                                    $7.20
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    one-time
                                </div>
                            </div>
                        </div>

                        <div className="flex items-baseline justify-between gap-6 p-6 md:p-8">
                            <div>
                                <div className="text-sm font-medium mb-1">
                                    OpenPlaud{" "}
                                    <span className="text-muted-foreground font-normal">
                                        + Groq Whisper
                                    </span>
                                </div>
                                <div className="text-xs text-muted-foreground/80">
                                    Same 1,200 minutes, paid to Groq directly
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums text-primary">
                                    $2.22
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    one-time
                                </div>
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-muted-foreground/80 mt-4 leading-relaxed">
                        OpenAI Whisper: $0.006 per minute. Groq Whisper Large
                        v3: $0.111 per hour. Rates as published by each
                        provider; you pay them directly with your own API key.
                    </p>
                </div>
            </div>
        </section>
    );
}
