import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Deploy } from "@/components/landing/deploy";
import { FAQ } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FinalCTA } from "@/components/landing/final-cta";
import { ForProfessionals } from "@/components/landing/for-professionals";
import { Hero } from "@/components/landing/hero";
import { HostedProAnnouncementBar } from "@/components/landing/hosted-pro-announcement-bar";
import { LandingNav } from "@/components/landing/landing-nav";
import { Pricing } from "@/components/landing/pricing";
import { TheMath } from "@/components/landing/the-math";
import { LandingFooter } from "@/components/landing-footer";
import { getFoundingMemberAvailability } from "@/db/queries/billing";
import { getSession } from "@/lib/auth-server";
import { env } from "@/lib/env";
import {
    resolveCurrency,
    resolveRequestCountry,
} from "@/lib/hosted/billing/pricing";
import { marketingMetadata } from "@/lib/seo/marketing-metadata";

export const metadata: Metadata = marketingMetadata({
    title: "Riffado | Open-source AI transcription for voice recorders",
    description:
        "Open-source transcription for the voice recorder you already own. Choose your AI, own your transcripts, deploy where you want. Currently supports the Plaud Note family: Note, Note Pro, and NotePin.",
    path: "/",
    ogImage: "/og-home.png",
});

export default async function HomePage() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
    }

    // Self-host instances don't serve the marketing landing -- send logged-out
    // visitors straight to login. The marketing surface is only meaningful on
    // the Riffado-operated hosted product, which sets IS_HOSTED=true.
    if (!env.IS_HOSTED) {
        redirect("/login");
    }

    const foundingAvailability = await getFoundingMemberAvailability(
        env.BILLING_FOUNDING_MEMBER_CAPACITY,
    );
    // Resolved once per tier, the same way checkout resolves it, and passed
    // down to every price-display section below. Stripe only ever charges a
    // buyer one currency -- showing "$5 or €5" implies a choice that
    // doesn't exist, and silently diverging from what checkout will
    // actually charge is worse. If `GEO_COUNTRY_HEADER` isn't configured on
    // this deployment, this (correctly) resolves to the same default
    // currency checkout uses.
    //
    // Resolved separately per tier: currency availability can differ
    // between the founding/standard monthly price and the annual price, so
    // reusing one resolved value across tiers can disagree with what
    // `startSubscriptionCheckout` actually resolves for that specific tier.
    const requestHeaders = await headers();
    const country = resolveRequestCountry((name) => requestHeaders.get(name));
    const activeMonthlyKind =
        foundingAvailability.remaining > 0 ? "founding" : "standard";
    const monthlyCurrency = resolveCurrency(
        country,
        "month",
        activeMonthlyKind,
    );
    const annualCurrency = resolveCurrency(country, "year", "standard");

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
            <HostedProAnnouncementBar
                availability={foundingAvailability}
                currency={monthlyCurrency}
            />
            <LandingNav />
            <main className="flex-1">
                <Hero />
                <TheMath
                    availability={foundingAvailability}
                    currency={monthlyCurrency}
                />
                <Features />
                {/* TODO: bring back a testimonials slot once we have
                    Riffado-specific quotes. The previous RedditQuotes
                    section republished disparaging Plaud-subscription
                    quotes and was removed for commercial-disparagement
                    risk. Do not reinstate without legal review. */}
                <ForProfessionals />
                <Pricing
                    availability={foundingAvailability}
                    monthlyCurrency={monthlyCurrency}
                    annualCurrency={annualCurrency}
                />
                <Deploy />
                <FAQ
                    availability={foundingAvailability}
                    monthlyCurrency={monthlyCurrency}
                    annualCurrency={annualCurrency}
                />
                <FinalCTA />
            </main>
            <LandingFooter />
        </div>
    );
}
