import Link from "next/link";
import { env } from "@/lib/env";
import { fetchLatestReleaseTag } from "@/lib/install-script";

import { APP_VERSION, compareSemver, releaseUrlFor } from "@/lib/version";

/**
 * Self-host-only "update available" indicator. Renders nothing on the
 * hosted instance (operators control deploys there -- a badge would be
 * noise + leak of internal state) and nothing when the operator opts
 * out via `DISABLE_UPDATE_CHECK=true`.
 *
 * Failure modes degrade silently to "no badge":
 *   - GitHub API down / rate-limited      -> fetchLatestReleaseTag() returns null
 *   - Egress blocked at network layer     -> fetchLatestReleaseTag() returns null
 *   - Tag doesn't match `vX.Y.Z` shape    -> fetchLatestReleaseTag() returns null
 *   - Current version >= latest            -> returns null here
 *
 * The fetch is cached 5 minutes (Next `revalidate: 300`) so this runs
 * at most ~12 times/hour per server, regardless of traffic.
 *
 * Server component on purpose: `env.IS_HOSTED` and `env.DISABLE_UPDATE_CHECK`
 * are server-only, and we don't want the badge to hydrate / flash on
 * the client.
 */
export async function UpdateBadge() {
    if (env.IS_HOSTED) return null;
    if (env.DISABLE_UPDATE_CHECK) return null;

    const latestTag = await fetchLatestReleaseTag();
    if (!latestTag) return null;
    // `compareSemver` returns null when either input fails to parse as
    // X.Y.Z -- treat that as "can't determine, hide the badge" rather
    // than surface a misleading or crashing UI. APP_VERSION is sourced
    // from package.json and not pre-validated against the tag regex,
    // so a malformed local version (e.g. "0.4.2-dirty") lands here.
    const cmp = compareSemver(APP_VERSION, latestTag);
    if (cmp === null) return null;
    if (cmp >= 0) return null;

    return (
        <Link
            href={releaseUrlFor(latestTag)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary/70 hover:text-primary transition-colors font-mono uppercase tracking-wider underline decoration-dotted underline-offset-2"
            aria-label={`Update available: ${latestTag}`}
            title={`Update available: ${latestTag} (running ${APP_VERSION})`}
        >
            {latestTag} available
        </Link>
    );
}
