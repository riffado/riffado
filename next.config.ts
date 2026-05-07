import type { NextConfig } from "next";

// Note: we read `process.env` directly here instead of importing the
// validated `env` from `src/lib/env.ts`. `next.config.ts` is evaluated
// before Next sets `NEXT_PHASE=phase-production-build`, so the build-phase
// skip in env.ts doesn't trigger and CI builds (which set placeholder
// ENCRYPTION_KEY etc.) would fail validation. Build configuration is the
// documented exception to the "no process.env in feature code" rule.
const IS_HOSTED = process.env.IS_HOSTED === "true";
const RYBBIT_HOST = process.env.RYBBIT_HOST?.replace(/\/$/, "");
const RYBBIT_SITE_ID = process.env.RYBBIT_SITE_ID;

const nextConfig: NextConfig = {
    output: "standalone",
    // The `/install.sh` and `/[version]/install.sh` routes read
    // `scripts/install.sh` from disk at request time. The standalone
    // output only includes files reachable through the build graph, so
    // declare the script as an extra traced input or it won't ship in
    // the Docker image. See `src/lib/install-script.ts`.
    outputFileTracingIncludes: {
        "/install.sh": ["./scripts/install.sh"],
        "/[version]/install.sh": ["./scripts/install.sh"],
    },
    images: {
        loader: "custom",
        loaderFile: "./loader.ts",
        remotePatterns: [],
    },
    async rewrites() {
        // Hosted-only stealth proxy for Rybbit analytics. Same-origin paths
        // bypass ad-blockers; the underscored `_int` prefix avoids analytics
        // keyword filters. Self-host (no IS_HOSTED + RYBBIT_*) registers no
        // rewrites and never proxies to Rybbit.
        if (!IS_HOSTED || !RYBBIT_HOST || !RYBBIT_SITE_ID) {
            return [];
        }
        // Explicit allowlist instead of a `:path*` catch-all so the upstream
        // Rybbit instance's full /api surface (admin/dashboard endpoints) is
        // never inadvertently exposed under our origin. Update this list if a
        // new tracking endpoint is added (e.g. session replay).
        return [
            {
                source: "/api/_int/s.js",
                destination: `${RYBBIT_HOST}/api/script.js`,
            },
            {
                source: "/api/_int/track",
                destination: `${RYBBIT_HOST}/api/track`,
            },
            {
                source: "/api/_int/identify",
                destination: `${RYBBIT_HOST}/api/identify`,
            },
        ];
    },
};

export default nextConfig;
