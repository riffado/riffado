import { HeroReveal } from "@/components/landing/hero-reveal";
import { HeroVisual } from "@/components/landing/hero-visual";

/**
 * Above-the-fold hero.
 *
 * Centered text band: headline, subhead, CTAs stacked and centered
 * at all breakpoints. Below: full-width screenshot that bleeds down
 * across the section boundary into TheMath, so the bg/border seam
 * passes behind the screenshot. TheMath compensates with extra top
 * padding (see `the-math.tsx`).
 *
 * Server component. Only the CTA pair + sticky-mobile bar are
 * client-side (`HeroReveal`) so the LCP element -- the headline --
 * ships as static HTML.
 */
export function Hero() {
    return (
        <section className="relative pt-12 md:pt-20">
            {/* Soft brand anchor behind the headline. */}
            <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-[radial-gradient(45%_40%_at_30%_25%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]"
            />

            <div className="container mx-auto px-4 relative">
                <div className="mx-auto max-w-3xl text-center">
                    <h1 className="text-[clamp(2.5rem,5.5vw,4.5rem)] font-semibold tracking-[-0.035em] leading-[1.05] text-foreground text-balance">
                        Every word from your recorder.{" "}
                        <span className="text-primary">
                            Searchable, summarized, and yours.
                        </span>
                    </h1>

                    <p className="mt-6 text-lg text-muted-foreground leading-[1.55] text-pretty mx-auto max-w-xl">
                        Sync in the background, transcribe with the AI you
                        choose — or free in your browser with Whisper — and keep
                        your audio where you choose.
                    </p>

                    <div className="mt-8 mx-auto max-w-md sm:max-w-none">
                        <HeroReveal />
                    </div>
                </div>
            </div>

            {/* Screenshot bleeds down into the next section. Negative
                margin-bottom pulls TheMath up so its bg/border seam
                runs roughly through the vertical middle of the image.
                `relative z-10` keeps the screenshot above TheMath's
                background fill. */}
            <div className="relative z-10 mt-12 md:mt-16 -mb-24 md:-mb-40 lg:-mb-56">
                <div className="mx-auto max-w-7xl px-4">
                    <HeroVisual />
                </div>
            </div>
        </section>
    );
}
