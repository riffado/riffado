/**
 * Single source of truth for the self-host install one-liner shown on
 * the marketing landing (`Deploy` section) and on `/install`. Keeping
 * the literal in one place prevents the two surfaces from drifting --
 * the install page is the canonical doc, the landing terminal is the
 * teaser, and they must show the exact same command.
 *
 * The URL itself is the deploy-surface contract -- it is served from
 * `src/app/install.sh/route.ts` and `src/app/[version]/install.sh/route.ts`.
 * Self-hosters paste these into their own runbooks; do not break the
 * URL shape silently. See AGENTS.md → "Don't break existing deployments".
 */

export const INSTALL_ONELINER =
    "curl -fsSL https://riffado.com/install.sh | sh";

export function pinnedInstallCommand(versionTag: string): string {
    return `curl -fsSL https://riffado.com/${versionTag}/install.sh | sh`;
}
