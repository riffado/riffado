import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    // Client source maps are only ever generated when the build is going
    // to inject+upload+delete them (see the guarded `posthog-cli` step in
    // the Dockerfile builder stage). Without `POSTHOG_CLI_API_KEY`, Next
    // never emits `.js.map` files at all, so there's nothing a self-host
    // build could accidentally ship publicly-servable.
    productionBrowserSourceMaps: Boolean(process.env.POSTHOG_CLI_API_KEY),
    // The PostHog same-origin proxy (`/psthg/*`) used to live here as a
    // static rewrite, but `rewrites()` is resolved once at `next build`
    // time and baked into the shared standalone image -- it can't gate on
    // `IS_HOSTED` or read `POSTHOG_HOST` at container runtime (both
    // deployment-time-only vars). Moved to route handlers under
    // `src/app/psthg/` (see `src/lib/posthog/proxy.ts`), which run
    // per-request and read live env, same pattern as the Rybbit proxy.
    skipTrailingSlashRedirect: true,
    // `scripts/install.sh` is read from disk at request time by the
    // /install.sh routes; declare it so the standalone tracer ships it.
    outputFileTracingIncludes: {
        "/install.sh": ["./scripts/install.sh"],
        "/[version]/install.sh": ["./scripts/install.sh"],
    },
    images: {
        loader: "custom",
        loaderFile: "./loader.ts",
        remotePatterns: [],
    },
    // @xenova/transformers statically imports Node-only optional deps
    // (`onnxruntime-node`, `sharp`). Browser transcription uses
    // `onnxruntime-web` inside a Web Worker, so stub those native deps
    // for both Next 16's Turbopack build path and the webpack fallback.
    turbopack: {
        resolveAlias: {
            "onnxruntime-node": "./src/lib/transcription/empty-module.ts",
            sharp: "./src/lib/transcription/empty-module.ts",
        },
    },
    webpack: (config) => {
        config.resolve = config.resolve ?? {};
        config.resolve.alias = {
            ...config.resolve.alias,
            "onnxruntime-node": false,
            sharp: false,
        };
        return config;
    },
};

const withMDX = createMDX({ outDir: "src/.source" });

export default withMDX(nextConfig);
