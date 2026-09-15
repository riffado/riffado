import Script from "next/script";
import { env } from "@/lib/env";

const OA_SCRIPT_URL = "https://oa.perier.pl/oa.js";
const OA_COLLECTOR_URL = "https://oa.perier.pl";

let warnedMisconfig = false;

/**
 * Cookieless Open Analytics snippet for hosted mode. Loads from the
 * operator collector with `data-storage="none"` so it does not write
 * cookies or localStorage, and is not gated on a consent banner.
 * Hard-gated on `IS_HOSTED`; self-host never injects the tag.
 */
export function OpenAnalytics() {
    if (!env.IS_HOSTED) return null;
    if (!env.OA_TRACKING_KEY) {
        if (!warnedMisconfig) {
            warnedMisconfig = true;
            console.warn(
                "[oa] IS_HOSTED=true but OA_TRACKING_KEY is unset; analytics disabled.",
            );
        }
        return null;
    }

    return (
        <Script
            src={OA_SCRIPT_URL}
            data-key={env.OA_TRACKING_KEY}
            data-collector={OA_COLLECTOR_URL}
            data-storage="none"
            strategy="afterInteractive"
        />
    );
}
