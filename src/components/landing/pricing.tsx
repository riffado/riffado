import { Check } from "lucide-react";
import Link from "next/link";
import { MetalButton } from "@/components/metal-button";
import type { FoundingMemberAvailabilityRow } from "@/db/queries/billing";
import {
    type BillingCurrency,
    billingPriceCatalog,
    type PublicPrice,
    pickDisplayPrice,
    trimDisplayAmount,
} from "@/lib/hosted/billing/pricing";

/**
 * Two ways to run Riffado. Same source. Pay for someone else to run
 * the server, or run it yourself for free.
 *
 * Design rules (read before editing):
 *
 * - Chrome is inherited from `the-math.tsx`: same `rounded-2xl`,
 *   same `bg-card` / `bg-card/50` pairing, same mono uppercase
 *   eyebrow, same tabular-nums price treatment. The two sections
 *   are intended to read as a single argument; do not introduce a
 *   second visual system here.
 *
 * - Two tiers only. There is no Hosted Free plan. The historical
 *   "Hosted Free" column was removed when the hosted product moved
 *   to a Pro-only model with a 14-day trial. Anyone who wants
 *   Riffado free runs it themselves. That positioning is the whole
 *   reason for the two-column layout -- restoring a "Hosted Free"
 *   sibling here will reintroduce the freemium-funnel mistake we
 *   explicitly rejected.
 *
 * - Hosted Pro carries emphasis. Self-host is the equal sibling,
 *   not a downgrade. The point is "two valid paths," not "free
 *   teaser + real product."
 *
 * - Feature copy names real vendors (OpenAI, Groq, Whisper) instead
 *   of "OpenAI-compatible providers." Per AGENTS.md positioning:
 *   category noun leads, named examples follow, "+ any
 *   OpenAI-compatible" is the escape hatch in small print -- never
 *   single-vendor framing that implies a default cloud.
 *
 * - Hosted Pro numbers (50 GB / 15 hr / unlimited devices) come from
 *   the entitlements catalog in `src/lib/entitlements.ts` and the
 *   `BILLING_PRO_*` env vars. If those move, update this copy in
 *   the same commit. Do not invent numbers that don't match the
 *   billing layer.
 *
 * - Trial copy is "14-day Pro trial, no card required." That's the
 *   actual signup flow. Founding-member (price locked for life) is
 *   the conversion lever; surface it visibly in the Hosted Pro
 *   column so the offer reaches users before they click through.
 *
 * - Prices are derived from `BILLING_PRICE_USD` / `BILLING_PRICE_EUR`
 *   (headline in USD; EU buyers are billed EUR, VAT included --
 *   Stripe Checkout localizes the real charge from the buyer's
 *   country). Annual availability and its amounts come from the
 *   billing price catalog; never invent an annual amount or a
 *   discount claim here. Founding-member copy is monthly-only --
 *   the price lock never applies to annual subscriptions.
 */
type Tier = {
    name: string;
    price: string;
    compareAtPrice?: string;
    priceSuffix: string;
    tagline: string;
    pill: { label: string; tone: "muted" | "primary" } | null;
    features: string[];
    cta: { label: string; href: string };
    emphasis: boolean;
    /** Optional small print under the feature list. */
    note?: string;
};

function formatCatalogPrice(price: PublicPrice, suffix: string): string {
    const symbol = price.currency === "usd" ? "$" : "€";
    const amount = price.displayAmount
        ? trimDisplayAmount(price.displayAmount)
        : null;
    return amount ? `${symbol}${amount}${suffix}` : "";
}

function buildTiers(
    availability: FoundingMemberAvailabilityRow,
    monthlyCurrency: BillingCurrency,
    annualCurrency: BillingCurrency,
): {
    tiers: Tier[];
    headlinePrice: string | null;
} {
    const catalog = billingPriceCatalog(availability);
    const primaryMonthly =
        availability.remaining > 0
            ? pickDisplayPrice(catalog.monthly.founding, monthlyCurrency)
            : pickDisplayPrice(catalog.monthly.standard, monthlyCurrency);
    const headlinePrice = primaryMonthly
        ? formatCatalogPrice(primaryMonthly, "")
        : null;
    const comparisonMonthly = pickDisplayPrice(
        catalog.monthly.standard,
        primaryMonthly?.currency ?? monthlyCurrency,
    );
    const compareAtPrice =
        availability.remaining > 0 && comparisonMonthly
            ? formatCatalogPrice(comparisonMonthly, "")
            : null;
    const foundingMonthly = pickDisplayPrice(
        catalog.monthly.founding,
        monthlyCurrency,
    );
    const standardMonthly = pickDisplayPrice(
        catalog.monthly.standard,
        monthlyCurrency,
    );
    const annual = pickDisplayPrice(catalog.annual, annualCurrency);
    const annualNote = annual
        ? ` Prefer to pay yearly? Annual billing is available at ${formatCatalogPrice(annual, "/year")}.`
        : "";
    const foundingNote =
        foundingMonthly && availability.remaining > 0
            ? ` ${availability.remaining} founding monthly spot${availability.remaining === 1 ? "" : "s"} left. Subscribe monthly to claim ${formatCatalogPrice(foundingMonthly, "/mo")} until the first ${availability.capacity} paid monthly members are gone.`
            : standardMonthly
              ? ` The founding monthly spots are gone. New monthly subscriptions are ${formatCatalogPrice(standardMonthly, "/mo")}.`
              : "";

    return {
        tiers: [
            {
                name: "Self-host",
                price: "Free",
                priceSuffix: "forever",
                tagline: "Your machine, your data, your rules.",
                pill: { label: "AGPL-3.0", tone: "muted" },
                features: [
                    "Unlimited recordings and storage",
                    "Runs on your laptop, NAS, or VPS via Docker",
                    "Plug in OpenAI, Groq, Ollama, or transcribe free in your browser",
                    "Store locally, or push to Cloudflare R2, Backblaze B2, or AWS S3",
                    "Every feature, no gates",
                ],
                cta: { label: "Deploy with Docker", href: "/install" },
                emphasis: false,
                note: "Want Riffado free? This is how. Bring your own server, AGPL source, no strings.",
            },
            {
                name: "Hosted Pro",
                price: headlinePrice ?? "Unavailable",
                compareAtPrice: compareAtPrice || undefined,
                priceSuffix: headlinePrice ? "/ month" : "",
                tagline: "Hosted, with the rough edges paid for.",
                pill: { label: "14-day free trial", tone: "primary" },
                features: [
                    "50 GB encrypted storage",
                    "15 hours of included Mynah transcription per month",
                    "Unlimited devices, background sync",
                    "Off-site encrypted backups (coming soon)",
                    "Plug in OpenAI, Groq, Ollama, or use ours",
                    "Export everything any time: JSON, TXT, SRT, VTT",
                    "Email support from the people who build it",
                ],
                cta: { label: "Start 14-day trial", href: "/register" },
                emphasis: true,
                note: `No card required to start.${foundingNote}${annualNote}`,
            },
        ],
        headlinePrice,
    };
}

export function Pricing({
    availability,
    monthlyCurrency,
    annualCurrency,
}: {
    availability: FoundingMemberAvailabilityRow;
    monthlyCurrency: BillingCurrency;
    annualCurrency: BillingCurrency;
}) {
    const { tiers, headlinePrice } = buildTiers(
        availability,
        monthlyCurrency,
        annualCurrency,
    );
    return (
        <section id="pricing" className="py-24 md:py-32">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-5xl">
                    <div className="max-w-2xl mb-12 md:mb-16">
                        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                            Pricing
                        </p>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                            Two ways to run it. Same source.
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed text-pretty">
                            {headlinePrice
                                ? `Pay us ${headlinePrice} a month and we run the server. `
                                : "Hosted billing is not configured on this instance. "}
                            Or run it yourself for free. Same code, same
                            features, every export round-trips.
                        </p>
                    </div>

                    {/*
                     * Subgrid on each card so header / features / CTA /
                     * note rows line up across both tiers regardless of
                     * how tall any individual section is.
                     */}
                    <div className="grid grid-cols-1 md:grid-cols-2 md:grid-rows-[auto_1fr_auto_auto] gap-4 md:gap-6">
                        {tiers.map((tier) => (
                            <TierCard key={tier.name} tier={tier} />
                        ))}
                    </div>

                    <p className="mt-8 text-xs text-muted-foreground/80 leading-relaxed text-pretty max-w-3xl">
                        Hosted runs the exact AGPL-3.0 source you can self-host
                        with no hidden fork and no proprietary add-ons.{" "}
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
            className={`relative rounded-2xl border p-6 md:p-7 md:grid md:grid-rows-subgrid md:row-span-4 flex flex-col gap-6 ${
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
                    {tier.compareAtPrice ? (
                        <span className="text-xl text-muted-foreground/70 line-through tabular-nums">
                            {tier.compareAtPrice}
                        </span>
                    ) : null}
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

            {tier.note ? (
                <p className="text-xs text-muted-foreground/70 leading-relaxed text-pretty">
                    {tier.note}
                </p>
            ) : null}
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
