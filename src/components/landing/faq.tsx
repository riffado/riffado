import Link from "next/link";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * Landing FAQ.
 *
 * Audience is the non-technical hosted user (see AGENTS.md
 * "Write marketing copy for the non-technical user"). Lead with
 * the objections that block sign-up -- price, device fit, what
 * "open source" means in practice -- before the operator-grade
 * questions about API changes and compliance.
 *
 * Named vendors lead ("OpenAI, Anthropic, Groq"); the
 * "+ any OpenAI-compatible endpoint" line is a tail clause for
 * the technical reader, never the lead.
 *
 * Plaud is referenced factually as the supported device family --
 * never as a competitor or a "subscription to escape." Per
 * AGENTS.md positioning rules.
 *
 * One global Accordion (`type="single"`) so only one question is
 * open at a time across all three groups -- group labels are
 * presentational headings, not separate accordion roots.
 */

type FaqItem = {
    q: string;
    /**
     * Rendered into the JSON-LD `acceptedAnswer.text` as plain text.
     * When a JSX `body` is also provided, keep this string in sync
     * with the full visible copy so the rich result matches what
     * the page actually shows.
     */
    a: string;
    /** Optional JSX answer; falls back to `a` when omitted. */
    body?: React.ReactNode;
};

type FaqGroup = {
    label: string;
    items: FaqItem[];
};

const GROUPS: FaqGroup[] = [
    {
        label: "Getting started",
        items: [
            {
                q: "Is hosted Riffado really free? What does it cost?",
                a: "The hosted free tier is real and stays real — sign up, connect your recorder, and use it. A paid Pro tier with higher limits and priority transcription is on a waitlist, but nothing about the free tier expires into it. And if you ever want zero cost and full control, self-hosting Riffado is free forever — same code, your machine.",
            },
            {
                q: "Do I need to pay for an AI provider to try this?",
                a: "No. Riffado transcribes right in your browser by default using Whisper — no API keys, no extra accounts, no per-minute cost. If you want faster or higher-quality transcripts later, plug in OpenAI or Groq, or run a local model with Ollama. The browser path is on by default and stays free forever.",
            },
            {
                q: "Which voice recorders does Riffado work with?",
                a: "Today, the Plaud Note family — Note, Note Pro, and NotePin. Support for more recorders is on the roadmap. If you own a Plaud, you can sign in with your existing account and your recordings start syncing in under a minute.",
            },
            {
                q: "Is Riffado really open source? What does that mean for me?",
                a: "Yes — the full source is on GitHub under AGPL-3.0. In practice: you can read every line, run it on your own machine, fork it, and leave whenever you want. The AGPL only adds obligations if you offer Riffado as a service to other people. For personal or team use, it's just free, forever, with the code in the open.",
            },
            {
                q: "How long does setup take?",
                a: "Hosted: about sixty seconds. Sign up, connect your Plaud account, and recordings start syncing. Self-host: one docker compose command against the published image. Postgres is included. No build step, no manual schema work.",
                body: (
                    <p>
                        <strong className="text-foreground font-medium">
                            Hosted:
                        </strong>{" "}
                        about sixty seconds. Sign up, connect your Plaud
                        account, and recordings start syncing.{" "}
                        <strong className="text-foreground font-medium">
                            Self-host:
                        </strong>{" "}
                        one{" "}
                        <code className="font-mono text-[0.9em] text-foreground/90 bg-muted/60 rounded px-1.5 py-0.5">
                            docker compose up
                        </code>{" "}
                        against the published image. Postgres is included. No
                        build step, no manual schema work.
                    </p>
                ),
            },
        ],
    },
    {
        label: "How it works",
        items: [
            {
                q: "Which AI providers can I use?",
                a: "OpenAI or Groq for cloud transcription. Ollama or LM Studio if you want a model running entirely on your own machine — nothing leaves your laptop. Browser-based Whisper if you don't want to configure anything at all. Pick per recording; change your mind any time. For summaries, any OpenAI-compatible endpoint works — that includes OpenAI, Anthropic via OpenRouter, Groq, Together, Azure, and others.",
                body: (
                    <>
                        <p>
                            <strong className="text-foreground font-medium">
                                OpenAI or Groq
                            </strong>{" "}
                            for cloud transcription.{" "}
                            <strong className="text-foreground font-medium">
                                Ollama
                            </strong>{" "}
                            or{" "}
                            <strong className="text-foreground font-medium">
                                LM Studio
                            </strong>{" "}
                            if you want a model running entirely on your own
                            machine — nothing leaves your laptop.{" "}
                            <strong className="text-foreground font-medium">
                                Browser-based Whisper
                            </strong>{" "}
                            if you don't want to configure anything at all. Pick
                            per recording; change your mind any time.
                        </p>
                        <p className="mt-3 text-sm text-muted-foreground/80">
                            For summaries, any OpenAI-compatible endpoint works
                            — that includes OpenAI, Anthropic via OpenRouter,
                            Groq, Together, Azure, and others.
                        </p>
                    </>
                ),
            },
            {
                q: "Does this affect my recorder's warranty or break the official app?",
                a: "No. Riffado signs into your Plaud account the same way the official web app does — through Plaud's existing API. Nothing about the hardware changes, and the official Plaud app keeps working alongside Riffado.",
            },
            {
                q: "What happens if Plaud changes their API?",
                a: "Worst case, new syncs pause until we ship an update — historically a matter of hours to days, because the project is open source and actively maintained. Your existing recordings are unaffected: once a recording has synced, it lives on storage you control and never depends on Plaud's servers again.",
            },
        ],
    },
    {
        label: "Your data, your exit",
        items: [
            {
                q: "Can I move between hosted and self-host later?",
                a: "Yes, in one click. The full-backup export gives you a single archive with every recording, transcript, and summary. Restore it into a self-hosted instance, or back into the hosted version, with nothing lost. Easy to leave is the whole point — so you don't have to overthink which one to start with.",
            },
            {
                q: "Where does my data live on the hosted version?",
                a: "Encrypted at rest on storage we operate. You can export everything, any time, no questions. If you need a specific jurisdiction or your own bucket, self-hosting points the same code at infrastructure you fully control.",
            },
            {
                q: "What about HIPAA, privileged legal work, or regulated financial data?",
                a: "We don't self-attest HIPAA compliance, and you should be skeptical of any transcription product that does. The meaningful privacy claim belongs to your AI provider, not to us. For regulated work, the right setup is self-hosting Riffado and plugging in a provider that signs a BAA you've reviewed (OpenAI Enterprise, Azure Speech, Deepgram), or running a local Whisper model so nothing leaves your machine. We give you the knobs; you own the compliance story.",
            },
        ],
    },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

function faqJsonLd() {
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: ALL_ITEMS.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: {
                "@type": "Answer",
                text: item.a,
            },
        })),
    };
}

export function FAQ() {
    return (
        <section id="faq" className="py-24 md:py-32 border-t border-border/40">
            {/* Rich-result eligibility. Sourced from the same `GROUPS`
                array as the visible copy -- single source of truth. */}
            <script
                type="application/ld+json"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD payload.
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(faqJsonLd()),
                }}
            />

            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto">
                    <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                        FAQ
                    </p>
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3 text-balance">
                        Questions before you sign up.
                    </h2>
                    <p className="text-muted-foreground leading-relaxed mb-10 md:mb-12 max-w-2xl">
                        The honest answers — including the boring ones.
                    </p>

                    <div className="rounded-2xl border border-border/60 bg-card/50 px-6 md:px-8 py-2 md:py-3">
                        <Accordion type="single" collapsible className="w-full">
                            {GROUPS.map((group, gi) => (
                                <div
                                    key={group.label}
                                    className={
                                        gi === 0
                                            ? "pt-4"
                                            : "pt-8 mt-2 border-t border-border/40"
                                    }
                                >
                                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground/70 mb-1">
                                        {group.label}
                                    </p>
                                    <div className="pb-4">
                                        {group.items.map((item, ii) => (
                                            <AccordionItem
                                                key={item.q}
                                                value={`faq-${gi}-${ii}`}
                                            >
                                                <AccordionTrigger>
                                                    {item.q}
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {item.body ?? (
                                                        <p>{item.a}</p>
                                                    )}
                                                </AccordionContent>
                                            </AccordionItem>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </Accordion>
                    </div>

                    <p className="text-sm text-muted-foreground mt-8 text-center">
                        Didn't see yours?{" "}
                        <Link
                            href="https://github.com/riffado/riffado"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground underline-offset-4 hover:underline"
                        >
                            Read the code
                        </Link>{" "}
                        or{" "}
                        <Link
                            href="https://github.com/riffado/riffado/issues/new/choose"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground underline-offset-4 hover:underline"
                        >
                            open an issue
                        </Link>
                        .
                    </p>
                </div>
            </div>
        </section>
    );
}
