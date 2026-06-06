import packageJson from "../../package.json" with { type: "json" };

export const APP_VERSION = packageJson.version;
export const APP_VERSION_TAG = `v${packageJson.version}`;
export const APP_RELEASE_URL = `https://github.com/r0073d-l053r/mesynx/releases/tag/${APP_VERSION_TAG}`;

/** Compare `vX.Y.Z` strings. Returns `null` (not 0) on unparseable input. */
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
    return `https://github.com/r0073d-l053r/mesynx/releases/tag/${tag}`;
}
