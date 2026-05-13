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
 * -1 / 0 / 1 with the usual semantics, or `null` if either input is
 * not a parseable bare `X.Y.Z` (optionally `v`-prefixed).
 *
 * Not a full semver implementation -- OpenPlaud tags are all bare
 * `vX.Y.Z` (enforced by `isValidVersionTag` in install-script.ts), so
 * three integers is all we need. No prerelease, no build metadata.
 * Adding the `semver` dep for three integer compares would be silly.
 *
 * Returning `null` (rather than throwing or returning 0) on bad input
 * is deliberate: callers like UpdateBadge surface updates via
 * `cmp < 0`, and silently coercing a malformed input to "equal" would
 * hide legitimate updates. Forcing callers to handle the null branch
 * keeps the failure mode explicit. Tag inputs from the GitHub API are
 * already pre-validated by `isValidVersionTag`; APP_VERSION comes
 * from package.json and is not pre-validated -- this is where the
 * null branch matters.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
    const parts = (s: string): [number, number, number] | null => {
        const p = s.replace(/^v/, "").split(".");
        if (p.length !== 3) return null;
        const nums = p.map(Number);
        if (nums.some((n) => Number.isNaN(n) || !Number.isFinite(n) || n < 0))
            return null;
        return [nums[0], nums[1], nums[2]];
    };
    const ap = parts(a);
    const bp = parts(b);
    if (!ap || !bp) return null;
    for (let i = 0; i < 3; i++) {
        if (ap[i] < bp[i]) return -1;
        if (ap[i] > bp[i]) return 1;
    }
    return 0;
}

export function releaseUrlFor(tag: string): string {
    return `https://github.com/openplaud/openplaud/releases/tag/${tag}`;
}
