import { ArrowRight, Github } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing-footer";
import { env } from "@/lib/env";
import { marketingMetadata } from "@/lib/seo/marketing-metadata";

const ON_PREMISES_EMAIL_BODY = [
    "Hello,",
    "",
    "We are exploring an on-premises Riffado setup.",
    "",
    "What must stay in-house (recordings, transcripts, the AI, or all three):",
    "",
    "What we already run, if anything (hardware, storage, an existing server):",
    "",
    "How we record today (devices, roughly how many people):",
    "",
].join("\r\n");

const ON_PREMISES_CONTACT = `mailto:support@riffado.com?subject=${encodeURIComponent(
    "On-premises Riffado setup",
)}&body=${encodeURIComponent(ON_PREMISES_EMAIL_BODY)}`;

const INQUIRY_PROMPTS = [
    "What must stay in-house: recordings, transcripts, the AI, or all three.",
    "What you already run, if anything: hardware, storage, an existing server.",
    "How your team records today: devices and roughly how many people.",
];

/**
 * Dedicated marketing page for the professional / sovereignty audience
 * (Slice 2 in AGENTS.md): lawyers, journalists, consultants,
 * researchers. Linked from the homepage `ForProfessionals` teaser and
 * the landing footer.
 *
 * Narrative: professional stakes → control model (custody ledger) →
 * practical workflow → per-profession scenarios → honest boundaries →
 * setup CTA. Assisted on-premises setup is the primary conversion
 * path; DIY self-host and Hosted Pro stay visible below it as
 * honestly presented alternatives. The assisted path never states a
 * price -- neither paid nor free.
 *
 * Copy rules (read before editing):
 *
 * - No compliance claims we don't own. HIPAA, SOC 2, attorney-client
 *   privilege, IRB/data-management approval -- never claimed, and the
 *   "Honest boundaries" section says so explicitly. That section is
 *   the trust-builder for this audience; do not soften it.
 * - Capture-side honesty is mandatory: recordings reach Plaud's
 *   servers via the official app before Riffado can sync them. The
 *   custody ledger and boundaries both state this. Removing it would
 *   turn the page into a lie of omission for exactly the readers who
 *   will check.
 * - Plaud is referenced factually as the supported device family,
 *   never as a competitor. Per AGENTS.md positioning rules.
 * - Export claims match the code: per-recording and bulk TXT / SRT /
 *   VTT / JSON via `/api/export`, full backup archive via
 *   `/api/backup`. The backup archive does not include audio files --
 *   do not claim "one archive with your audio."
 * - Hosted-only surface, same reasoning as the `(legal)` layout: the
 *   marketing site only exists on the Riffado-operated hosted
 *   product, so self-host instances 404 this route.
 */

export const metadata: Metadata = marketingMetadata({
    title: "Riffado for Professionals | Transcription on hardware you control",
    description:
        "For lawyers, journalists, consultants, and researchers: keep recordings and transcripts on hardware you control, transcribe with AI that never leaves the building, and export everything at any time. Open source, AGPL-3.0.",
    path: "/for-professionals",
});

type LedgerRow = {
    step: string;
    title: string;
    body: string;
    holder: string;
    /** "you" renders the holder in primary; "external" stays muted. */
    holderTone: "you" | "external";
};

const LEDGER: LedgerRow[] = [
    {
        step: "01",
        title: "Capture",
        body: "Your recorder uploads to your Plaud account, exactly as it does today. Riffado changes nothing about how you record.",
        holder: "Your recorder → Plaud",
        holderTone: "external",
    },
    {
        step: "02",
        title: "Sync",
        body: "Riffado signs into your Plaud account and pulls each new recording down. From this step on, nothing depends on anyone else's cloud.",
        holder: "You",
        holderTone: "you",
    },
    {
        step: "03",
        title: "Storage",
        body: "Audio and transcripts land on your own disk, or in a bucket you own: Cloudflare R2, Backblaze B2, or AWS S3.",
        holder: "You",
        holderTone: "you",
    },
    {
        step: "04",
        title: "Transcription",
        body: "Whisper runs free in your browser, or Ollama and LM Studio run on your hardware. The audio never leaves the building.",
        holder: "You",
        holderTone: "you",
    },
    {
        step: "05",
        title: "Summaries",
        body: "A local model keeps everything in-house. Or plug in a cloud provider you picked, under your account, your key, your terms.",
        holder: "You",
        holderTone: "you",
    },
    {
        step: "06",
        title: "Export",
        body: "Every transcript in one file: TXT, SRT, VTT, or JSON. Plus a full backup archive. Leaving is a feature, not a negotiation.",
        holder: "You",
        holderTone: "you",
    },
];

type WorkflowBeat = {
    step: string;
    title: string;
    body: string;
};

const WORKFLOW: WorkflowBeat[] = [
    {
        step: "01",
        title: "Record like you already do.",
        body: "The recorder in the meeting, the interview, the glovebox. Your capture habits don't change, and the official app keeps working alongside Riffado.",
    },
    {
        step: "02",
        title: "Transcripts appear without ceremony.",
        body: "Riffado syncs new recordings in the background. Transcribe free with Whisper in your browser, or point it at Ollama on your own machine and let it run unattended.",
    },
    {
        step: "03",
        title: "Find the sentence. Cite the minute.",
        body: "Search every word you've ever recorded. Player and transcript sit side by side with timestamps intact, and any recording exports as text or subtitles.",
    },
];

type Profession = {
    label: string;
    body: string;
};

const PROFESSIONS: Profession[] = [
    {
        label: "Lawyers",
        body: "Client meetings, dictation, matter notes. Run Riffado on office hardware with local transcription, and no new vendor enters the picture between your recorder and your archive. When a client asks where recordings of their matter live, the answer is one sentence: on our machines.",
    },
    {
        label: "Journalists",
        body: "Interviews come with promises attached. With local transcription, no transcription service ever holds the tape: the recording syncs to your laptop and the AI runs there too. Search years of interviews without putting a source's voice in someone else's cloud.",
    },
    {
        label: "Consultants",
        body: "Engagement notes and client workshops, searchable across every project. When an NDA or a security questionnaire asks where client data goes, you can describe the whole path -- your server, your storage, your model -- without a single \u201cit depends.\u201d",
    },
    {
        label: "Researchers",
        body: "Participant interviews often come with commitments about where recordings will live. Self-hosting lets you keep those commitments literally: one machine, one storage location, transcription that runs on it. Simple to describe in a data-management plan, simple to verify.",
    },
];

type Boundary = {
    title: string;
    body: ReactNode;
};

const BOUNDARIES: Boundary[] = [
    {
        title: "No compliance certifications.",
        body: "Riffado is not HIPAA or SOC 2 certified, and we won't pretend otherwise. The meaningful claims belong to your setup: your hardware, your AI provider's terms, your policies. We give you the knobs; you own the compliance story.",
    },
    {
        title: "Capture still passes through Plaud.",
        body: "Your recorder uploads to Plaud's servers before Riffado can sync it. That's how the device works today, with or without us. Once a recording syncs, it lives on storage you control and never depends on Plaud's servers again.",
    },
    {
        title: "Cloud AI means a cloud provider.",
        body: "If you point transcription at OpenAI or Groq instead of a local model, that provider processes your audio under your account and their terms. Browser Whisper and Ollama exist precisely so you don't have to.",
    },
    {
        title: "Hosted means trusting us.",
        body: "On Hosted Pro, we operate the storage. It's encrypted at rest and you can export everything at any time, but the trust boundary is us, and we'd rather say so than let you assume otherwise. For maximum control, self-host.",
    },
    {
        title: "Don't take our word for any of this.",
        body: (
            <>
                Every line of Riffado is AGPL-3.0 on{" "}
                <Link
                    href="https://github.com/riffado/riffado"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline decoration-dotted underline-offset-2 hover:text-foreground/80 transition-colors"
                >
                    GitHub
                </Link>
                . Read it, audit it, or hand it to someone who audits things for
                a living. The page you're on has to be honest because the code
                can be checked against it.
            </>
        ),
    },
];

export default function ForProfessionalsPage() {
    if (!env.IS_HOSTED) {
        notFound();
    }

    return (
        <div className="min-h-dvh flex flex-col bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
            <LandingNav />
            <main className="flex-1">
                {/* Stakes */}
                <section className="pt-16 md:pt-24 pb-16 md:pb-24">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-3xl">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono uppercase tracking-wider mb-6 text-muted-foreground">
                                <span>For professionals</span>
                                <span
                                    aria-hidden
                                    className="text-muted-foreground/40"
                                >
                                    {"//"}
                                </span>
                                <span className="text-muted-foreground/80">
                                    Lawyers · Journalists · Consultants ·
                                    Researchers
                                </span>
                            </div>

                            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-balance mb-6">
                                If your conversations stay in the room, your
                                recordings should too.
                            </h1>

                            <p className="text-lg text-muted-foreground leading-relaxed text-pretty max-w-2xl mb-8">
                                Client calls, source interviews, engagement
                                notes, field research. Riffado turns the voice
                                recorder you already carry into a transcript
                                archive that runs on hardware you control,
                                transcribed by AI that answers to you, readable
                                by no one you haven't chosen.
                            </p>

                            <div className="flex flex-wrap gap-3">
                                <Link
                                    href={ON_PREMISES_CONTACT}
                                    className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium"
                                >
                                    Plan an on-premises setup
                                    <ArrowRight className="size-4" />
                                </Link>
                                <Link
                                    href="https://github.com/riffado/riffado"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md border border-border bg-background hover:bg-secondary/40 transition-colors text-sm font-medium"
                                >
                                    <Github className="size-4" />
                                    Read the source
                                </Link>
                            </div>

                            <p className="mt-6 text-sm text-muted-foreground">
                                Works with the Plaud Note family today: Note,
                                Note Pro, and NotePin. More recorders are on the
                                roadmap.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Control model: the custody ledger */}
                <section className="py-20 md:py-24 border-y border-border/40 bg-secondary/10">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-4xl">
                            <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                                The control model
                            </p>
                            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                                Who holds your words, step by step.
                            </h2>
                            <p className="text-muted-foreground text-lg leading-relaxed text-pretty max-w-2xl mb-10">
                                For professional work, we recommend an
                                on-premises deployment with local AI. We can
                                help you plan and set it up on infrastructure
                                you control. One step still involves a party you
                                didn't choose, and it's the one you already live
                                with.
                            </p>

                            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                                <div className="hidden sm:grid grid-cols-[3.5rem_1fr_auto] gap-4 px-5 md:px-6 py-3 border-b border-border bg-background/40">
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                        Step
                                    </span>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                        What happens
                                    </span>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                        Who holds it
                                    </span>
                                </div>
                                <ol>
                                    {LEDGER.map((row, i) => (
                                        <li
                                            key={row.step}
                                            className={`grid grid-cols-1 sm:grid-cols-[3.5rem_1fr_auto] gap-x-4 gap-y-2 px-5 md:px-6 py-5 ${
                                                i < LEDGER.length - 1
                                                    ? "border-b border-border/60"
                                                    : ""
                                            }`}
                                        >
                                            <span className="text-xs font-mono text-muted-foreground pt-0.5 tabular-nums">
                                                {row.step}
                                            </span>
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold mb-1">
                                                    {row.title}
                                                </h3>
                                                <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
                                                    {row.body}
                                                </p>
                                            </div>
                                            <span
                                                className={`justify-self-start sm:justify-self-end self-start text-[11px] font-mono uppercase tracking-wider rounded px-2 py-1 border ${
                                                    row.holderTone === "you"
                                                        ? "border-primary/40 text-primary bg-primary/5"
                                                        : "border-border/60 text-muted-foreground"
                                                }`}
                                            >
                                                {row.holder}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            </div>

                            <p className="mt-6 text-sm text-muted-foreground leading-relaxed text-pretty max-w-2xl">
                                Riffado with local AI adds no new third party
                                after your recorder. Prefer a cloud model for
                                speed or quality? Plug in OpenAI or Groq under
                                your own account, and the ledger changes at
                                exactly one step, by your decision.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Practical workflow */}
                <section className="py-20 md:py-24">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-4xl">
                            <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                                In practice
                            </p>
                            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                                Set it up once. Then it's just your mornings.
                            </h2>
                            <p className="text-muted-foreground text-lg leading-relaxed text-pretty max-w-2xl mb-10">
                                You don't need to become your own infrastructure
                                team. We can configure Riffado, storage, and
                                local AI on your hardware, then leave you with a
                                workflow built for daily use.
                            </p>

                            <ol className="grid grid-cols-1 md:grid-cols-3 md:divide-x divide-y md:divide-y-0 divide-border/60 border-y border-border/60">
                                {WORKFLOW.map((beat) => (
                                    <li
                                        key={beat.step}
                                        className="py-7 md:py-8 md:px-6 md:first:pl-0 md:last:pr-0"
                                    >
                                        <span className="text-xs font-mono text-muted-foreground tracking-wider">
                                            {beat.step}
                                        </span>
                                        <h3 className="mt-3 text-base font-semibold leading-snug tracking-tight mb-2 text-balance">
                                            {beat.title}
                                        </h3>
                                        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
                                            {beat.body}
                                        </p>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                </section>

                {/* Per-profession scenarios */}
                <section className="py-20 md:py-24 border-y border-border/40 bg-secondary/10">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-4xl">
                            <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                                Who this is for
                            </p>
                            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-10 text-balance max-w-2xl">
                                Different obligations. Same architecture.
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                                {PROFESSIONS.map((p) => (
                                    <div key={p.label}>
                                        <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
                                            {p.label}
                                        </h3>
                                        <p className="text-sm text-foreground/90 leading-relaxed text-pretty">
                                            {p.body}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <p className="mt-10 text-sm text-muted-foreground leading-relaxed text-pretty max-w-2xl">
                                None of this makes compliance automatic. What it
                                makes is a setup simple enough to describe
                                truthfully, which is where every real
                                confidentiality story starts.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Honest boundaries */}
                <section className="py-20 md:py-24">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-3xl">
                            <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                                Honest boundaries
                            </p>
                            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                                What we don't claim.
                            </h2>
                            <p className="text-muted-foreground text-lg leading-relaxed text-pretty mb-10">
                                You'll be asked hard questions about your setup.
                                Here are the answers we won't dress up.
                            </p>

                            <dl className="space-y-8">
                                {BOUNDARIES.map((b) => (
                                    <div key={b.title}>
                                        <dt className="text-base font-semibold mb-2">
                                            {b.title}
                                        </dt>
                                        <dd className="text-sm text-muted-foreground leading-relaxed text-pretty">
                                            {b.body}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </div>
                </section>

                {/* On-premises setup CTA */}
                <section className="py-20 md:py-24 border-t border-border/40 bg-secondary/10">
                    <div className="container mx-auto px-4">
                        <div className="mx-auto max-w-4xl">
                            <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                                On-premises, without the setup burden
                            </p>
                            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance max-w-2xl">
                                Keep control of the infrastructure. Let us
                                handle the setup.
                            </h2>
                            <p className="text-muted-foreground text-lg leading-relaxed text-pretty max-w-2xl mb-10">
                                We can help deploy Riffado on hardware you
                                control, connect your storage and local AI, and
                                prepare the recorder-to-transcript workflow for
                                your practice, newsroom, consultancy, or lab.
                            </p>

                            <div className="rounded-2xl border border-primary/40 bg-card p-6 md:p-8 shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)_inset]">
                                <div className="grid gap-8 md:grid-cols-[1.05fr_1fr] md:gap-10">
                                    <div>
                                        <div className="text-xs font-mono uppercase tracking-wider text-primary mb-3">
                                            Setup with the Riffado team
                                        </div>
                                        <h3 className="text-xl font-semibold tracking-tight text-balance mb-4">
                                            An on-premises deployment shaped
                                            around your constraints.
                                        </h3>
                                        <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                                            <li>
                                                Hardware and deployment planning
                                            </li>
                                            <li>
                                                Storage and local AI
                                                configuration
                                            </li>
                                            <li>
                                                Recorder sync and export
                                                workflow
                                            </li>
                                            <li>
                                                A clear handoff your team can
                                                understand
                                            </li>
                                        </ul>
                                    </div>

                                    <div className="border-t border-border/60 pt-6 md:border-t-0 md:pt-0 md:border-l md:pl-8 lg:pl-10">
                                        <h4 className="text-sm font-semibold mb-1">
                                            Start with one email.
                                        </h4>
                                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                                            Three things make the first reply
                                            useful:
                                        </p>
                                        <ol className="space-y-2.5 mb-6">
                                            {INQUIRY_PROMPTS.map(
                                                (prompt, i) => (
                                                    <li
                                                        key={prompt}
                                                        className="flex gap-3"
                                                    >
                                                        <span
                                                            aria-hidden
                                                            className="pt-0.5 text-xs font-mono text-muted-foreground/70 tabular-nums"
                                                        >
                                                            {String(
                                                                i + 1,
                                                            ).padStart(2, "0")}
                                                        </span>
                                                        <span className="text-sm text-muted-foreground leading-relaxed text-pretty">
                                                            {prompt}
                                                        </span>
                                                    </li>
                                                ),
                                            )}
                                        </ol>
                                        <Link
                                            href={ON_PREMISES_CONTACT}
                                            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                                        >
                                            Email us about your setup
                                            <ArrowRight className="size-4" />
                                        </Link>
                                    </div>
                                </div>
                            </div>

                            <p className="mt-8 mb-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                                Two other ways to run Riffado
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="flex flex-col rounded-xl border border-border bg-card/50 px-5 py-5">
                                    <h3 className="text-sm font-semibold mb-1">
                                        Prefer to deploy it yourself?
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed text-pretty mb-4">
                                        Riffado is free and open source, with a
                                        one-command Docker installer. It's the
                                        same deployment we'd set up for you,
                                        done at your own pace.
                                    </p>
                                    <Link
                                        href="/docs/self-hosting"
                                        className="mt-auto inline-flex items-center gap-2 text-sm font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground transition-colors"
                                    >
                                        Read the self-host guide
                                        <ArrowRight className="size-4" />
                                    </Link>
                                </div>

                                <div className="flex flex-col rounded-xl border border-border bg-card/50 px-5 py-5">
                                    <h3 className="text-sm font-semibold mb-1">
                                        Want us to run it instead?
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed text-pretty mb-4">
                                        Hosted Pro runs the same open-source
                                        code, with encrypted storage and full
                                        export whenever you want to move.
                                    </p>
                                    <Link
                                        href="/register"
                                        className="mt-auto inline-flex items-center gap-2 text-sm font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground transition-colors"
                                    >
                                        Start a 14-day trial
                                        <ArrowRight className="size-4" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <LandingFooter />
        </div>
    );
}
