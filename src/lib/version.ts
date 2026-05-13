import packageJson from "../../package.json" with { type: "json" };

/**
 * Single source of truth for the running OpenPlaud version.
 *
 * Sourced from `package.json` at build time so there's no runtime fs
 * read and no extra bundle weight (Next inlines the import as a string
 * constant). Anything user-visible — footer, /api/health, install
 * script — reads from here so we don't grow a second "what version
 * are we?" code path.
 *
 * Drift between this value and the latest published GitHub tag is
 * caught by `.github/workflows/release.yml` (tag/version equality
 * gate). If those disagree, the release fails loud rather than
 * publishing a mislabeled artifact.
 */
export const APP_VERSION = packageJson.version;
export const APP_VERSION_TAG = `v${packageJson.version}`;
export const APP_RELEASE_URL = `https://github.com/openplaud/openplaud/releases/tag/${APP_VERSION_TAG}`;

/**
 * Compare two 3-part dotted version strings ("0.4.2", "0.5.0"). Returns
 * -1 / 0 / 1 with the usual semantics. Tolerates a leading `v`.
 *
 * Not a full semver implementation -- OpenPlaud tags are all bare
 * `vX.Y.Z` (enforced by `isValidVersionTag` in install-script.ts), so
 * three integers is all we need. No prerelease, no build metadata.
 * Adding the `semver` dep for three integer compares would be silly.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
    const ap = a.replace(/^v/, "").split(".").map(Number);
    const bp = b.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        const av = ap[i] ?? 0;
        const bv = bp[i] ?? 0;
        if (Number.isNaN(av) || Number.isNaN(bv)) return 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    return 0;
}

export function releaseUrlFor(tag: string): string {
    return `https://github.com/openplaud/openplaud/releases/tag/${tag}`;
}
