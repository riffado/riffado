import { Cpu, LayoutDashboard, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

/**
 * "How it works" section. Three compact beats matching the three
 * Hero promises -- Searchable, summarized, and yours.
 *
 * Each beat is a single short paragraph. Claims must map to real
 * behavior in the codebase. Export formats are JSON / TXT / SRT /
 * VTT plus full-archive -- do not add "Markdown".
 */

type Beat = {
    step: string;
    icon: ReactNode;
    title: string;
    body: string;
};

const BEATS: Beat[] = [
    {
        step: "01",
        icon: <RefreshCw className="size-5" />,
        title: "Sign in once, sync forever.",
        body: "Log in with the same email you use for your recorder — Mesynx AI sends you a code, just like the app. New recordings show up on their own, and you get a notification when they're ready.",
    },
    {
        step: "02",
        icon: <Cpu className="size-5" />,
        title: "Pick the AI. Get the transcript.",
        body: "Use OpenAI or Groq for transcription, plug in Anthropic or others for summaries — you pay them directly at their published rate. No account anywhere? Transcription runs free, right in your browser. Every recording comes back with a summary, key points, and action items.",
    },
    {
        step: "03",
        icon: <LayoutDashboard className="size-5" />,
        title: "Search, listen, send it anywhere.",
        body: "Player and transcript side-by-side. Search across every word you've ever recorded. Send a single recording to Notion, Obsidian, or your video editor — or download everything as one archive. Open source, end to end.",
    },
];

export function Features() {
    return (
        <section id="features" className="py-20 md:py-24">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-5xl">
                    <div className="max-w-3xl mb-12">
                        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                            How it works
                        </p>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                            A workstation around the recorder you already have.
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed text-pretty">
                            Your recorder keeps recording. Mesynx AI picks up
                            after the audio leaves the device — and lets you
                            pick the AI, the storage, and where it all lives.
                        </p>
                    </div>

                    <ol className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x divide-y lg:divide-y-0 divide-border/60 border-y border-border/60">
                        {BEATS.map((b) => (
                            <BeatItem key={b.step} {...b} />
                        ))}
                    </ol>

                    <p className="mt-8 text-sm text-muted-foreground text-pretty">
                        Free in your browser. Or plug in OpenAI or Groq and pay
                        them directly.
                    </p>
                </div>
            </div>
        </section>
    );
}

function BeatItem({ step, icon, title, body }: Beat) {
    return (
        <li className="py-8 lg:py-10 lg:px-7 lg:first:pl-0 lg:last:pr-0">
            <div className="flex items-center gap-3 mb-5">
                <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                    {icon}
                </div>
                <span className="text-xs font-mono text-muted-foreground tracking-wider">
                    {step}
                </span>
            </div>
            <h3 className="text-lg font-semibold leading-snug tracking-tight mb-2 text-balance">
                {title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
                {body}
            </p>
        </li>
    );
}
