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
};

const withMDX = createMDX({ outDir: "src/.source" });

export default withMDX(nextConfig);
