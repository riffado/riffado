import Image from "next/image";

/**
 * Above-the-fold product visual.
 *
 * Real product screenshots captured from `/dev/demo-dashboard` against
 * the fixtures in `src/lib/demo/fixtures.ts`. Two variants are shipped,
 * one per theme, toggled by the `.dark` class Tailwind applies via the
 * theme provider -- so an explicit theme toggle is honored, not just
 * `prefers-color-scheme`.
 *
 * Renders as a fully rounded, contained product surface. Sits inside
 * the Hero's soft padded panel; the rounded card reads as a framed
 * screenshot rather than a bleed crop.
 *
 * Server component; zero client JS.
 */
export function HeroVisual() {
    return (
        <div className="relative">
            {/* Soft brand glow behind the frame. Subtle; the screenshot
                does the heavy lifting now, so the glow only needs to
                anchor it to the headline above. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-12 -top-8 -z-10 h-40 rounded-[3rem] bg-[radial-gradient(60%_60%_at_50%_30%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)] blur-2xl"
            />

            <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_60px_-20px_color-mix(in_oklch,var(--foreground)_18%,transparent)]">
                {/* Fully contained product surface. Sits inside the
                    outer padded panel (see Hero) so the rounded card
                    reads as a framed screenshot, not a bleed crop. */}
                <div className="relative aspect-[16/10] w-full">
                    <Image
                        src="/landing/hero-light.webp"
                        alt="Mesynx AI dashboard showing a transcribed board meeting with summary and action items"
                        fill
                        priority
                        sizes="(min-width: 1280px) 1216px, 100vw"
                        className="object-cover object-top dark:hidden"
                    />
                    <Image
                        src="/landing/hero-dark.webp"
                        alt=""
                        aria-hidden
                        fill
                        sizes="(min-width: 1280px) 1216px, 100vw"
                        className="hidden object-cover object-top dark:block"
                    />
                </div>
            </div>
        </div>
    );
}
