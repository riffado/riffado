import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { FoundingMemberAvailabilityRow } from "@/db/queries/billing";
import { env } from "@/lib/env";
import {
    type BillingCurrency,
    billingPriceCatalog,
    type PublicPrice,
    pickDisplayPrice,
    trimDisplayAmount,
} from "@/lib/hosted/billing/pricing";

function formatMonthlyPrice(price: PublicPrice): string | null {
    if (!price.displayAmount) return null;
    const symbol = price.currency === "usd" ? "$" : "€";
    return `${symbol}${trimDisplayAmount(price.displayAmount)}/month`;
}

/** Public launch notice. It disappears automatically when founding capacity is gone. */
export function HostedProAnnouncementBar({
    availability,
    currency,
}: {
    availability: FoundingMemberAvailabilityRow;
    currency: BillingCurrency;
}) {
    if (!env.BILLING_ENABLED || availability.remaining <= 0) return null;

    const catalog = billingPriceCatalog(availability);
    const price = pickDisplayPrice(catalog.monthly.founding, currency);
    const formattedPrice = price ? formatMonthlyPrice(price) : null;
    if (!formattedPrice) return null;

    return (
        <section
            aria-label="Hosted Pro announcement"
            className="border-b border-primary/20 bg-primary/8 text-foreground"
        >
            <div className="container mx-auto flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-pretty">
                <span>
                    <strong>Hosted Pro is live.</strong>{" "}
                    {availability.remaining} founding monthly spot
                    {availability.remaining === 1 ? "" : "s"} left at{" "}
                    {formattedPrice}.
                </span>
                <Link
                    href="#pricing"
                    className="inline-flex shrink-0 items-center gap-1 text-foreground/80 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                >
                    See Hosted Pro
                    <ArrowRight className="size-3.5" aria-hidden />
                </Link>
            </div>
        </section>
    );
}
