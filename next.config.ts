import type { NextConfig } from "next";
import { env } from "./src/lib/env";

const nextConfig: NextConfig = {
    output: "standalone",
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
        if (!env.IS_HOSTED || !env.RYBBIT_HOST || !env.RYBBIT_SITE_ID) {
            return [];
        }
        const host = env.RYBBIT_HOST.replace(/\/$/, "");
        return [
            {
                source: "/api/_int/s.js",
                destination: `${host}/api/script.js`,
            },
            {
                source: "/api/_int/:path*",
                destination: `${host}/api/:path*`,
            },
        ];
    },
};

export default nextConfig;
