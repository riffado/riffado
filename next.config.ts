import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
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
    // @xenova/transformers (in-browser Whisper transcription) lists
    // `onnxruntime-node` and `sharp` as optional native deps it only
    // uses on a Node server. We run it exclusively in a browser Web
    // Worker (onnxruntime-web), so stub those out to keep the bundler
    // from trying to resolve native binaries. Both the Turbopack (dev)
    // and webpack (build) resolvers need the alias.
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
