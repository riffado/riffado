"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "mesynx-ai:rebrand:announcement";
const EXPIRES_AT = new Date("2026-07-28T00:00:00Z");

/**
 * Top-of-landing rebrand announcement.
 *
 * Catches signed-out visitors and anyone who hit `mesynx-ai.com` via a
 * stale `openplaud` link or memory. Sits above `LandingNav` (not part
 * of the sticky header) so it scrolls away after one read instead of
 * permanently eating viewport, especially on mobile.
 *
 * Render strategy: default to visible in server HTML. The client island
 * reads localStorage on mount and hides if previously dismissed.
 * Already-dismissed users get a brief flash; the alternative (everyone
 * sees the bar appear after hydration) was worse.
 *
 * Hard-expires on `EXPIRES_AT`. After that date the component returns
 * null regardless of dismissal -- avoids stale announcement chrome
 * haunting the page indefinitely after the rebrand has settled.
 *
 * Sibling to `<RebrandBanner />` in the signed-in app. Existing hosted
 * users with active sessions never see this surface because `/`
 * redirects them to `/dashboard`; the in-app banner covers them.
 */
export function RebrandAnnouncementBar() {
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(STORAGE_KEY) === "dismissed") {
                setDismissed(true);
            }
        } catch {
            // localStorage can throw in privacy/incognito modes -- treat
            // as "not dismissed" and render the bar. Functional fallback.
        }
    }, []);

    if (Date.now() > EXPIRES_AT.getTime()) return null;
    if (dismissed) return null;

    return (
        <section
            aria-label="Announcement"
            className="relative border-b border-primary/20 bg-primary/8 text-foreground"
        >
            <div className="container mx-auto px-4 py-2.5 pr-12 flex items-center justify-center gap-2 text-sm text-pretty">
                <span className="font-medium">OpenPlaud is now Mesynx AI.</span>
                <Link
                    href="/rebrand"
                    className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                >
                    Read more
                    <ArrowRight className="size-3.5" aria-hidden />
                </Link>
            </div>
            <button
                type="button"
                onClick={() => {
                    setDismissed(true);
                    try {
                        localStorage.setItem(STORAGE_KEY, "dismissed");
                    } catch {
                        // Best-effort -- if storage is unavailable the bar
                        // simply reappears next visit. Acceptable.
                    }
                }}
                aria-label="Dismiss announcement"
                className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
                <X className="size-4" aria-hidden />
            </button>
        </section>
    );
}
