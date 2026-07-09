"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MetalButton } from "@/components/metal-button";

/**
 * Rybbit `window.rybbit.event(name, props?)` shape. The script is loaded
 * via `<Script strategy="afterInteractive">` (see `RybbitAnalytics`), so
 * the global may not exist yet at first render -- always guard.
 *
 * Mirrors the declaration in `hero-reveal.tsx`; TS merges the two
 * `Window` augmentations at the type level so duplication is safe.
 */
declare global {
    interface Window {
        rybbit?: {
            event?: (name: string, props?: Record<string, unknown>) => void;
        };
    }
}

function track(name: string, props?: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    try {
        window.rybbit?.event?.(name, props);
    } catch {
        // Analytics must never break the page.
    }
}

/**
 * Client island for the page-closer CTA pair. Parallels `HeroReveal`
 * but without the staggered reveal or sticky-mobile sentinel -- by the
 * time a visitor reaches the final CTA they've already scrolled the
 * full page, so no entrance animation and no sticky bar.
 *
 * Fires:
 *   - `final_cta_view` once, when the CTA row scrolls into view
 *     (IntersectionObserver, threshold 0.4) -- mount-time tracking
 *     would fire on every page load since this island hydrates with
 *     the page, making the event indistinguishable from page-view
 *   - `final_cta_primary_click` on Start free
 *   - `final_cta_self_host_click` on the self-host link
 */
export function FinalCtaActions() {
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        let fired = false;
        const obs = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting && !fired) {
                        fired = true;
                        track("final_cta_view");
                        obs.disconnect();
                    }
                }
            },
            { threshold: 0.4 },
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    return (
        <div
            ref={rootRef}
            className="flex flex-col gap-5 items-center justify-center pt-2"
        >
            <MetalButton
                asChild
                size="lg"
                className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-12 px-7 text-base shadow-[0_0_28px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
            >
                <Link
                    href="/register"
                    aria-label="Start Riffado free, no card required"
                    onClick={() =>
                        track("final_cta_primary_click", {
                            location: "final_cta",
                        })
                    }
                >
                    <span>Start free</span>
                    <ArrowRight className="size-4" />
                </Link>
            </MetalButton>

            {/* Mirrors the hero's secondary action verbatim so the page
                opens and closes on the same two paths. */}
            <Link
                href="/install"
                aria-label="Self-host Riffado in one command"
                onClick={() =>
                    track("final_cta_self_host_click", {
                        location: "final_cta",
                    })
                }
                className="group inline-flex items-center justify-center gap-1.5 text-sm font-medium text-auth-brand-foreground/60 hover:text-auth-brand-foreground transition-colors"
            >
                <span>or self-host in one command</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
        </div>
    );
}
