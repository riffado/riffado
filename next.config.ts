import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Point next-intl at our request-config helper so server components and
// route handlers can call `getTranslations()` without per-route plumbing.
// See src/i18n/request.ts for the locale-resolution rules.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// The Rybbit analytics proxy used to live here as a `rewrites()` entry.
// `next.config.ts` is evaluated at `next build`, and the published Docker
// image is built generically without `IS_HOSTED`/`RYBBIT_*` set, so the
// rewrite list was baked as `[]` and `/api/_int/*` 404'd at runtime even
// when those vars were configured on the host. The proxy now lives as
// runtime route handlers under `src/app/api/int/*` which read `env` at
// request time, in lockstep with `<RybbitAnalytics>`'s render gate.
//
// Folder name note: route folder is `int`, NOT `_int`. App Router treats
// `_`-prefixed folders as private and excludes them from the route
// manifest, which silently 404'd every `/api/_int/*` path via the
// prerendered not-found page — a separate regression from the
// build-time-rewrites one above.
const nextConfig: NextConfig = {
    output: "standalone",
    // `wreq-js` is a Rust napi addon used by `src/lib/plaud/fetch.ts` to
    // emit a Chrome-shaped TLS handshake when calling Plaud through the
    // Webshare proxy (see `src/lib/plaud/fetch.ts`). The package ships
    // prebuilt `.node` binaries that Turbopack can't bundle into ESM
    // chunks (`non-ecmascript placeable asset`). Externalise so Next
    // leaves the require in place and node-file-trace pulls the binary
    // into the standalone output at runtime.
    serverExternalPackages: ["wreq-js"],
    // The `/install.sh` and `/[version]/install.sh` routes read
    // `scripts/install.sh` from disk at request time. The standalone
    // output only includes files reachable through the build graph, so
    // declare the script as an extra traced input or it won't ship in
    // the Docker image. See `src/lib/install-script.ts`.
    //
    // `wreq-js` is listed in `serverExternalPackages` above so Turbopack
    // leaves a runtime `externalImport("wreq-js")` in the output. Under
    // Next 16 + Turbopack, the file tracer does NOT follow that dynamic
    // import, so `node_modules/wreq-js` is missing from
    // `.next/standalone/node_modules` and the server boots into
    //   `Cannot find package 'wreq-js' from '.next/server/chunks/[turbopack]_runtime.js'`
    // the moment any Plaud helper loads (only when `WEBSHARE_API_KEY` is
    // set — direct egress doesn't pull this module in). Pull the whole
    // package, including its prebuilt `.node` binaries, into the trace
    // explicitly. The `"/**/*"` route key applies the include to every
    // route, since the Plaud fetch is reachable from sync, OTP, workspace
    // token, recording mutations, and the dev probe.
    outputFileTracingIncludes: {
        "/install.sh": ["./scripts/install.sh"],
        "/[version]/install.sh": ["./scripts/install.sh"],
        "/**/*": ["./node_modules/wreq-js/**/*"],
    },
    images: {
        loader: "custom",
        loaderFile: "./loader.ts",
        remotePatterns: [],
    },
};

// Fumadocs MDX integration. `createMDX()` reads `source.config.ts`, emits
// compiled content into `src/.source/` (see `outDir` below), and registers
// the `.mdx` webpack loader.
// The wrapper is a no-op for non-MDX routes — self-host and hosted builds are
// identical with or without docs content present.
// `outDir` is set under `src/` so the existing `@/*` -> `./src/*` tsconfig
// path alias resolves `@/.source` without adding a second alias. Keep this
// in lockstep with the `.gitignore` entry and the import in `src/lib/source.ts`.
const withMDX = createMDX({ outDir: "src/.source" });

export default withMDX(withNextIntl(nextConfig));
