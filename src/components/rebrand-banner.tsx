"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "mesynx-ai:rebrand:in-app-banner";
const EXPIRES_AT = new Date("2026-07-28T00:00:00Z");

/**
 * In-app rebrand banner.
 *
 * Mounted at the top of the signed-in `(app)` layout so existing
 * hosted users (who skip the landing entirely -- `/` redirects them to
 * `/dashboard`) are told about the name change the next time they
 * open the app.
 *
 * Same dismissal + expiration pattern as `<RebrandAnnouncementBar />`,
 * but a distinct storage key -- dismissing the landing announcement
 * should not also dismiss the in-app banner, and vice versa. The two
 * surfaces reach different audiences and each one should get one
 * dismissal opportunity.
 *
 * Gating: the parent layout decides whether to mount this; the
 * component itself does not read `env`. Self-host operators do not
 * see this surface (layout-level gate).
 */
export function RebrandBanner() {
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(STORAGE_KEY) === "dismissed") {
                setDismissed(true);
            }
        } catch {
            // localStorage can throw in privacy/incognito modes -- treat
            // as "not dismissed" and render the banner. Functional fallback.
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
                <span className="text-muted-foreground hidden sm:inline">
                    Same project, same code, same team.
                </span>
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
                        // Best-effort -- if storage is unavailable the
                        // banner simply reappears next visit. Acceptable.
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
