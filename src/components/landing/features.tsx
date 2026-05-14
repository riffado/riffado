import { Cpu, Database, Download, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "@/components/panel";

export function Features() {
    return (
        <section className="py-24">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mb-16">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                        What OpenPlaud does.
                    </h2>
                    <p className="text-muted-foreground text-lg leading-relaxed">
                        Four things, in order. Your Plaud Note keeps recording
                        exactly as it does today; we replace everything that
                        happens after.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl">
                    <FeatureCard
                        step="01"
                        icon={<RefreshCw className="size-5" />}
                        title="Pulls recordings from your Plaud Note"
                        description="Log in with your existing Plaud account. OpenPlaud syncs your recordings in the background — no manual exports, no copy-pasting bearer tokens. Works with Plaud Note, Note Pro, and NotePin."
                    />
                    <FeatureCard
                        step="02"
                        icon={<Cpu className="size-5" />}
                        title="Transcribes with the AI you choose"
                        description="Plug in OpenAI, Anthropic, Groq, Deepgram, or run Llama locally through Ollama. You pay the provider directly — pennies per hour instead of a subscription. Switch providers any time without re-transcribing."
                    />
                    <FeatureCard
                        step="03"
                        icon={<Database className="size-5" />}
                        title="Stores audio where you choose"
                        description="Local filesystem, your own S3-compatible bucket (AWS, Cloudflare R2, Backblaze, MinIO, Wasabi), or OpenPlaud-hosted storage if you don't want to think about it. Your recordings, on infrastructure you control."
                    />
                    <FeatureCard
                        step="04"
                        icon={<Download className="size-5" />}
                        title="Exports to anything, anywhere"
                        description="One click to Markdown, JSON, SRT, or VTT — ready for Notion, Obsidian, a video editor, or your own pipeline. Full backups are a single endpoint away. No lock-in, by design."
                    />
                </div>
            </div>
        </section>
    );
}

function FeatureCard({
    step,
    icon,
    title,
    description,
}: {
    step: string;
    icon: ReactNode;
    title: string;
    description: string;
}) {
    return (
        <Panel
            variant="default"
            className="space-y-4 h-full hover:border-primary/40 transition-colors"
        >
            <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                    {icon}
                </div>
                <span className="text-xs font-mono text-muted-foreground tracking-wider">
                    {step}
                </span>
            </div>
            <h3 className="text-xl font-semibold leading-tight">{title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
                {description}
            </p>
        </Panel>
    );
}
