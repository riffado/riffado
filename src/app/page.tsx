import type { Metadata } from "next";
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

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
            <HostedProAnnouncementBar availability={foundingAvailability} />
            <LandingNav />
            <main className="flex-1">
                <Hero />
                <TheMath availability={foundingAvailability} />
                <Features />
                {/* TODO: bring back a testimonials slot once we have
                    Riffado-specific quotes. The previous RedditQuotes
                    section republished disparaging Plaud-subscription
                    quotes and was removed for commercial-disparagement
                    risk. Do not reinstate without legal review. */}
                <ForProfessionals />
                <Pricing availability={foundingAvailability} />
                <Deploy />
                <FAQ availability={foundingAvailability} />
                <FinalCTA />
            </main>
            <LandingFooter />
        </div>
    );
}
