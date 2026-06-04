"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MetalButton } from "@/components/metal-button";
import { cn } from "@/lib/utils";

/**
 * Rybbit `window.rybbit.event(name, props?)` shape. The script is loaded
 * via `<Script strategy="afterInteractive">` (see `RybbitAnalytics`), so
 * the global may not exist yet at first render -- always guard.
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
 * Client-only wrapper for the hero interactive region.
 *
 * Responsibilities:
 *   1. Staggered entrance reveal on mount (CSS-driven, `prefers-reduced-motion`
 *      honored -- collapses to instant opacity-1 with no transform).
 *   2. Renders the primary + secondary CTAs with tracked clicks.
 *   3. Fires `hero_view` once per session on mount.
 *   4. IntersectionObserver to surface a sticky mobile CTA bar once the
 *      hero scrolls out of view, hidden again at the page footer.
 *
 * Kept tiny on purpose: parent Hero stays a server component and only this
 * island ships to the client. No animation library; pure CSS transitions
 * driven by a single `mounted` boolean.
 */
export function HeroReveal() {
    const [mounted, setMounted] = useState(false);
    const [showStickyCta, setShowStickyCta] = useState(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setMounted(true);
        track("hero_view");
    }, []);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        let firedScrollPast = false;
        const obs = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    // When the sentinel (a 1px element at the end of the
                    // hero) leaves the viewport, the hero is gone -- show
                    // sticky CTA. When it re-enters, hide it.
                    const passed = !entry.isIntersecting;
                    setShowStickyCta(passed);
                    if (passed && !firedScrollPast) {
                        firedScrollPast = true;
                        track("hero_scroll_past");
                    }
                }
            },
            { threshold: 0 },
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    // Stagger via inline transitionDelay -- one shared transition spec,
    // each child gets its own delay. `data-revealed` toggles the end state.
    const reveal = (delayMs: number) => ({
        className:
            "motion-safe:transition-[opacity,transform] motion-safe:duration-[450ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:data-[revealed=false]:opacity-0 motion-safe:data-[revealed=false]:translate-y-2 data-[revealed=true]:opacity-100 data-[revealed=true]:translate-y-0",
        style: { transitionDelay: `${delayMs}ms` },
        "data-revealed": mounted,
    });

    return (
        <>
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-stretch sm:items-center justify-center">
                <div {...reveal(120)}>
                    <MetalButton
                        asChild
                        size="lg"
                        className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-12 px-7 text-base shadow-[0_0_28px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
                    >
                        <Link
                            href="/register"
                            aria-label="Start Mesynx AI free — no card required"
                            onClick={() =>
                                track("hero_cta_primary_click", {
                                    location: "hero",
                                })
                            }
                        >
                            <span>Start free</span>
                            <ArrowRight className="size-4" />
                        </Link>
                    </MetalButton>
                </div>

                {/* Secondary action is a quiet text link, not a button.
                    On the hosted landing the primary path is sign-up;
                    self-host is a Slice-2 escape hatch. Equal-weight
                    buttons fought the hierarchy and made the page read
                    as undecided. */}
                <div
                    {...reveal(180)}
                    className={cn(reveal(180).className, "flex justify-center")}
                >
                    <Link
                        href="/install"
                        aria-label="Self-host Mesynx AI in one command"
                        onClick={() =>
                            track("hero_cta_self_host_click", {
                                location: "hero",
                            })
                        }
                        className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <span>or self-host in one command</span>
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                </div>
            </div>

            {/* Sentinel sits at the very bottom of the hero. When it
                scrolls out of view, the mobile sticky CTA mounts. */}
            <div ref={sentinelRef} aria-hidden className="h-px w-full" />

            {/* Mobile-only sticky CTA. Hidden on sm+ because desktop users
                see the FinalCTA without needing a persistent bar. */}
            <div
                aria-hidden={!showStickyCta}
                className={`fixed inset-x-0 bottom-0 z-40 sm:hidden pointer-events-none transition-opacity duration-200 ${
                    showStickyCta ? "opacity-100" : "opacity-0"
                }`}
            >
                <div className="pointer-events-auto border-t border-border bg-background/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <MetalButton
                        asChild
                        size="lg"
                        className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-12 px-7 text-base shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
                    >
                        <Link
                            href="/register"
                            tabIndex={showStickyCta ? 0 : -1}
                            aria-label="Start Mesynx AI free — no card required"
                            onClick={() =>
                                track("hero_cta_primary_click", {
                                    location: "sticky_mobile",
                                })
                            }
                        >
                            <span>Start free</span>
                            <ArrowRight className="size-4" />
                        </Link>
                    </MetalButton>
                </div>
            </div>
        </>
    );
}
