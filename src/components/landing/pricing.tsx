import { Check } from "lucide-react";
import Link from "next/link";
import { MetalButton } from "@/components/metal-button";

/**
 * Three ways to run Riffado. Same source, same features -- the axis
 * is "who runs the server."
 *
 * Design rules (read before editing):
 *
 * - Chrome is inherited from `the-math.tsx`: same `rounded-2xl`,
 *   same `bg-card` / `bg-card/50` pairing, same mono uppercase
 *   eyebrow, same tabular-nums price treatment. The two sections
 *   are intended to read as a single argument; do not introduce a
 *   second visual system here.
 *
 * - Exactly one tier carries emphasis (`emphasis: true`). Everything
 *   else uses the muted chrome. Three competing visual signatures
 *   (dashed, plain, glow) was the previous mistake -- the eye had
 *   nowhere to land. Hosted Pro is the focal point; Self-host and
 *   Hosted Free are equal siblings around it.
 *
 * - Pills (AGPL badge, "Recommended", "Coming soon") share one
 *   primitive so they read as the same element type, not three.
 *
 * - Feature copy names real vendors (OpenAI, Groq, Whisper) instead
 *   of "OpenAI-compatible providers." Per AGENTS.md positioning:
 *   category noun leads, named examples follow, "+ any
 *   OpenAI-compatible" is the escape hatch in small print -- never
 *   single-vendor framing that implies a default cloud.
 *
 * - Feature lists only claim what the code actually delivers today.
 *   The previous Hosted Free caps (500 min / 10 GB / 1 device) were
 *   placeholders; there is no quota plumbing. Until it exists, do
 *   not invent numbers.
 *
 * - Hosted Pro is a waitlist tier. There is no billing layer, no
 *   `?plan=pro` handler in `/register`, no Stripe. The CTA captures
 *   intent (free signup) and the "Coming soon" pill is the honest
 *   signal. Do not re-introduce a "Start Pro" CTA until billing
 *   actually ships.
 *
 * - The bottom "Industry context" callout was removed. `TheMath`
 *   already runs the three-vendor survey directly above this
 *   section; repeating it here was noise and risked
 *   commercial-disparagement framing.
 */
type Tier = {
    name: string;
    price: string;
    priceSuffix: string;
    tagline: string;
    pill: { label: string; tone: "muted" | "primary" } | null;
    features: string[];
    cta: { label: string; href: string };
    emphasis: boolean;
};

const TIERS: Tier[] = [
    {
        name: "Self-host",
        price: "Free",
        priceSuffix: "forever",
        tagline: "Your machine, your data, your rules.",
        pill: { label: "AGPL-3.0", tone: "muted" },
        features: [
            "Unlimited recordings and storage",
            "Runs on your laptop, NAS, or VPS via Docker",
            "Plug in OpenAI, Groq, Ollama — or transcribe free in your browser",
            "Store locally, or push to Cloudflare R2, Backblaze B2, or AWS S3",
            "Every feature, no gates",
        ],
        cta: { label: "Deploy with Docker", href: "/install" },
        emphasis: false,
    },
    {
        name: "Hosted Free",
        price: "$0",
        priceSuffix: "/ month",
        tagline: "We run the server. You bring the keys.",
        pill: null,
        features: [
            "Sync from your Plaud recorder",
            "Free transcription in your browser (Whisper)",
            "Plug in OpenAI or Groq for cloud transcription",
            "Export everything anytime — JSON, TXT, SRT, VTT",
            "Same source as self-host (AGPL-3.0)",
        ],
        cta: { label: "Start free", href: "/register" },
        emphasis: false,
    },
    {
        name: "Hosted Pro",
        price: "$5",
        priceSuffix: "/ month",
        tagline: "Hosted, with the rough edges paid for.",
        pill: { label: "Coming soon", tone: "primary" },
        features: [
            "Everything in Hosted Free",
            "Priority sync and background jobs",
            "Off-site encrypted backups",
            "Email support from the people who build it",
            "Early access to new device support",
        ],
        cta: { label: "Join the waitlist", href: "/register" },
        emphasis: true,
    },
];

export function Pricing() {
    return (
        <section id="pricing" className="py-24 md:py-32">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-6xl">
                    <div className="max-w-2xl mb-12 md:mb-16">
                        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                            Pricing
                        </p>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                            Pick the version that fits you.
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed text-pretty">
                            Same product, same source. The only difference is
                            who runs the server — and whether you'd rather not
                            think about it.
                        </p>
                    </div>

                    {/*
                     * Subgrid on each card so header / features / CTA /
                     * note rows line up across all three tiers regardless
                     * of how tall any individual section is. Without
                     * this, varying feature-list lengths and the Pro-only
                     * note push buttons onto different baselines.
                     */}
                    <div className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-[auto_1fr_auto] gap-4 md:gap-6">
                        {TIERS.map((tier) => (
                            <TierCard key={tier.name} tier={tier} />
                        ))}
                    </div>

                    <p className="mt-8 text-xs text-muted-foreground/80 leading-relaxed text-pretty max-w-3xl">
                        Hosted runs the exact AGPL-3.0 source you can self-host
                        — no hidden fork, no proprietary add-ons.{" "}
                        <Link
                            href="https://github.com/riffado/riffado"
                            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground transition-colors"
                        >
                            Read the source
                        </Link>
                        . You can move between Hosted and Self-host at any time
                        using full-archive export.
                    </p>
                </div>
            </div>
        </section>
    );
}

function TierCard({ tier }: { tier: Tier }) {
    return (
        <div
            className={`relative rounded-2xl border p-6 md:p-7 md:grid md:grid-rows-subgrid md:row-span-3 flex flex-col gap-6 ${
                tier.emphasis
                    ? "border-primary/40 bg-card shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)_inset]"
                    : "border-border bg-card/50"
            }`}
        >
            <div>
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        {tier.name}
                    </div>
                    {tier.pill ? <Pill {...tier.pill} /> : null}
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-4xl md:text-5xl font-semibold tracking-tight tabular-nums leading-none">
                        {tier.price}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                        {tier.priceSuffix}
                    </span>
                </div>
                <p className="text-sm text-muted-foreground leading-snug">
                    {tier.tagline}
                </p>
            </div>

            <ul className="space-y-3">
                {tier.features.map((f) => (
                    <li
                        key={f}
                        className="flex items-start gap-2.5 text-sm leading-snug"
                    >
                        <Check
                            className={`size-4 mt-0.5 shrink-0 ${
                                tier.emphasis
                                    ? "text-primary"
                                    : "text-muted-foreground"
                            }`}
                            aria-hidden
                        />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <MetalButton
                asChild
                size="lg"
                className={`w-full ${
                    tier.emphasis
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50"
                        : "bg-background/50"
                }`}
            >
                <Link href={tier.cta.href}>{tier.cta.label}</Link>
            </MetalButton>
        </div>
    );
}

function Pill({ label, tone }: { label: string; tone: "muted" | "primary" }) {
    return (
        <span
            className={`text-[10px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                tone === "primary"
                    ? "border-primary/40 text-primary bg-primary/5"
                    : "border-border/60 text-muted-foreground"
            }`}
        >
            {label}
        </span>
    );
}
