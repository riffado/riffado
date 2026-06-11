import Script from "next/script";
import { env } from "@/lib/env";

let warnedMisconfig = false;

export function RybbitAnalytics() {
    if (!env.IS_HOSTED) return null;
    if (!env.RYBBIT_SITE_ID || !env.RYBBIT_HOST) {
        if (!warnedMisconfig) {
            warnedMisconfig = true;
            console.warn(
                "[rybbit] IS_HOSTED=true but RYBBIT_SITE_ID and/or RYBBIT_HOST are unset; analytics disabled.",
            );
        }
        return null;
    }

    return (
        <Script
            src="/api/int/script.js"
            data-site-id={env.RYBBIT_SITE_ID}
            strategy="afterInteractive"
        />
    );
}
