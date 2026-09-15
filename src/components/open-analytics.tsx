import Script from "next/script";
import { env } from "@/lib/env";

let warnedMisconfig = false;

function scriptUrl(host: string): string {
    const origin = host.replace(/\/$/, "");
    return `${origin}/oa.js`;
}

/**
 * Cookieless Open Analytics snippet for hosted mode. Loads from OA_HOST
 * with `data-storage="none"` so it does not write cookies or localStorage,
 * and is not gated on a consent banner. Hard-gated on `IS_HOSTED`;
 * self-host never injects the tag. Both OA_TRACKING_KEY and OA_HOST must
 * be set or the snippet stays off.
 */
export function OpenAnalytics() {
    if (!env.IS_HOSTED) return null;
    if (!env.OA_TRACKING_KEY || !env.OA_HOST) {
        if (!warnedMisconfig) {
            warnedMisconfig = true;
            console.warn(
                "[oa] IS_HOSTED=true but OA_TRACKING_KEY and/or OA_HOST are unset; analytics disabled.",
            );
        }
        return null;
    }

    const host = env.OA_HOST.replace(/\/$/, "");

    return (
        <Script
            src={scriptUrl(host)}
            data-key={env.OA_TRACKING_KEY}
            data-collector={host}
            data-storage="none"
            strategy="afterInteractive"
        />
    );
}
