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
