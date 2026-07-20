import { getFoundingMemberAvailability } from "@/db/queries/billing";
import { env } from "@/lib/env";
import {
    billingPriceCatalog,
    trimDisplayAmount,
} from "@/lib/hosted/billing/pricing";

/**
 * Industry-survey-style pricing context. Three-vendor format (not
 * head-to-head) using each vendor's own published numbers. Reframe
 * any future edits the same way: factual, dated, no qualitative
 * claims about competitors, no implication that subscription
 * services are overpriced. We show how the underlying-AI economics
 * work -- the reader does the math themselves.
 *
 * The Hosted Pro row stays monthly-framed and derives its amount
 * from the first configured monthly catalog Price (USD preferred);
 * the per-hour figure uses the configured included transcription allowance.
 *
 * `perHour` is the price normalized to one hour of audio where a row
 * has a fixed minute allowance or published metered rate. Subscription
 * rows divide the sticker price by the plan's included minutes;
 * Riffado rows either show the Hosted Pro included allowance or the
 * upstream provider's published per-minute/per-hour rate. Always the
 * vendor's own number -- never a derived "savings" claim.
 */
const SUBSCRIPTION_SERVICES = [
    {
        name: "Plaud Pro",
        price: "$17.99",
        unit: "/ month",
        scope: "1,200 transcription minutes",
        perHour: "$0.90 / hr",
    },
    {
        name: "Otter Business",
        price: "$30",
        unit: "/ user / month",
        scope: "6,000 transcription minutes",
        perHour: "$0.30 / hr",
    },
    {
        name: "Rev Essentials",
        price: "$29.99",
        unit: "/ seat / month",
        scope: "5,000 transcription minutes",
        perHour: "$0.36 / hr",
    },
];

const HOSTED_PRO_INCLUDED_HOURS = env.BILLING_PRO_INCLUDED_SECONDS / 3600;

export async function TheMath() {
    const availability = await getFoundingMemberAvailability(
        env.BILLING_FOUNDING_MEMBER_CAPACITY,
    );
    const catalog = billingPriceCatalog(availability);
    const foundingPrice =
        catalog.monthly.founding.usd ?? catalog.monthly.founding.eur;
    const standardPrice =
        catalog.monthly.standard.usd ?? catalog.monthly.standard.eur;
    const foundingOfferActive =
        availability.remaining > 0 && foundingPrice !== null;
    const monthlyPrice = foundingOfferActive ? foundingPrice : standardPrice;
    const monthlyAmount = monthlyPrice?.displayAmount ?? null;
    const currencySymbol = monthlyPrice?.currency === "eur" ? "€" : "$";
    const displayPrice = monthlyAmount
        ? `${currencySymbol}${trimDisplayAmount(monthlyAmount)}`
        : "Unavailable";
    const riffadoOptions: Row[] = [
        {
            name: "Hosted Pro + Mynah",
            notice: foundingOfferActive
                ? `Limited founding offer · ${availability.remaining} spot${availability.remaining === 1 ? "" : "s"} left`
                : undefined,
            price: displayPrice,
            unit: monthlyAmount ? "/ month" : "",
            scope: `${HOSTED_PRO_INCLUDED_HOURS} hours of included cloud transcription + 50 GB storage`,
            perHour:
                monthlyAmount && HOSTED_PRO_INCLUDED_HOURS > 0
                    ? `${currencySymbol}${(
                          Number.parseFloat(monthlyAmount) /
                              HOSTED_PRO_INCLUDED_HOURS
                      ).toFixed(2)} / included hr`
                    : "—",
        },
        {
            name: "Riffado in your browser",
            price: "$0.00",
            unit: "free",
            scope: "Whisper via Transformers.js, no key required",
            perHour: "$0.00 / hr",
        },
        {
            name: "Bring your own AI provider",
            price: "At cost",
            unit: "no markup",
            scope: "OpenAI, Groq, Ollama, LM Studio, or another compatible provider",
            perHour: "provider rate",
        },
    ];

    return (
        <section className="pt-40 md:pt-56 lg:pt-72 pb-24 border-y border-border/40 bg-secondary/10">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-5xl">
                    <div className="max-w-2xl">
                        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mb-4">
                            What your monthly price includes
                        </p>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4 text-balance">
                            {HOSTED_PRO_INCLUDED_HOURS} hours of transcription.
                            No separate AI bill.
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed text-pretty">
                            Hosted Pro includes Mynah cloud transcription for
                            everyday use. You can also transcribe free in your
                            browser, or connect OpenAI, Groq, Ollama, or another
                            provider. Riffado adds no markup when you bring your
                            own.
                        </p>
                    </div>

                    <div className="mt-10 grid gap-4 lg:grid-cols-2 lg:gap-6 items-stretch">
                        <PriceTable
                            label="Subscription services"
                            rows={SUBSCRIPTION_SERVICES}
                            tone="muted"
                        />
                        <PriceTable
                            label="With Riffado"
                            rows={riffadoOptions}
                            tone="primary"
                            highlightFirst
                        />
                    </div>

                    <p className="mt-6 text-xs text-muted-foreground/80 leading-relaxed text-pretty max-w-2xl">
                        Published monthly pricing as of July 2026. Plans, minute
                        ceilings, and trademarks belong to their respective
                        owners; shown for descriptive context, not comparison.
                        Hosted Pro includes {HOSTED_PRO_INCLUDED_HOURS} hours of
                        Mynah transcription per month; Riffado itself is free to
                        self-host.
                    </p>
                </div>
            </div>
        </section>
    );
}

type Row = {
    name: string;
    notice?: string;
    price: string;
    unit: string;
    scope: string;
    perHour: string;
};

function PriceTable({
    label,
    rows,
    tone,
    highlightFirst,
}: {
    label: string;
    rows: Row[];
    /**
     * Both cards share identical chrome (border, radius, row height,
     * price font size) so they pair as a single comparison. Hierarchy
     * comes from `tone` -- subscriptions render in muted-foreground,
     * Riffado in foreground, the highlighted free row in primary --
     * never from size. Resizing prices made the rows misalign in the
     * previous version.
     */
    tone: "muted" | "primary";
    /**
     * Riffado side leads with the strongest proof (free in browser).
     * Highlight the first row instead of the last so the eye lands on
     * "$0.00" before scanning the rest.
     */
    highlightFirst?: boolean;
}) {
    const isMuted = tone === "muted";
    return (
        <div
            className={`rounded-2xl border border-border overflow-hidden h-full flex flex-col ${
                isMuted ? "bg-card/50" : "bg-card"
            }`}
        >
            <div className="px-5 md:px-6 py-3 border-b border-border bg-background/40">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    {label}
                </div>
            </div>
            <div className="flex-1 flex flex-col">
                {rows.map((row, i) => {
                    const isFirst = i === 0;
                    const highlight = highlightFirst && isFirst;
                    return (
                        <div
                            key={row.name}
                            className={`flex-1 flex items-center justify-between gap-4 px-5 md:px-6 py-5 ${
                                i < rows.length - 1
                                    ? "border-b border-border"
                                    : ""
                            }`}
                        >
                            <div className="min-w-0">
                                {row.notice ? (
                                    <div className="mb-1 text-xs font-medium text-primary">
                                        {row.notice}
                                    </div>
                                ) : null}
                                <div className="text-sm font-medium text-foreground mb-1 truncate">
                                    {row.name}
                                </div>
                                <div className="text-xs leading-snug text-muted-foreground">
                                    {row.scope}
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div
                                    className={`text-3xl md:text-4xl font-semibold tracking-tight tabular-nums leading-none ${
                                        highlight
                                            ? "text-primary"
                                            : isMuted
                                              ? "text-muted-foreground"
                                              : "text-foreground"
                                    }`}
                                >
                                    {row.price}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground tabular-nums">
                                    {row.unit}
                                    <span className="text-muted-foreground/60">
                                        {" "}
                                        &middot; {row.perHour}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
