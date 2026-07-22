import { PostHogIdentify } from "@/components/posthog-identify";
import { PostHogInit } from "@/components/posthog-init";
import { env } from "@/lib/env";

let warnedMisconfig = false;

/**
 * Hard-gated on `IS_HOSTED` -- self-host deployments never call
 * `posthog.init()`, even if `POSTHOG_KEY` happens to be set. Mirrors
 * `RybbitAnalytics`'s gating shape.
 */
export function PostHogAnalytics() {
    if (!env.IS_HOSTED) return null;
    if (!env.POSTHOG_KEY) {
        if (!warnedMisconfig) {
            warnedMisconfig = true;
            console.warn(
                "[posthog] IS_HOSTED=true but POSTHOG_KEY is unset; analytics disabled.",
            );
        }
        return null;
    }

    return (
        <>
            <PostHogInit
                apiKey={env.POSTHOG_KEY}
                uiHost="https://eu.posthog.com"
            />
            <PostHogIdentify />
        </>
    );
}
