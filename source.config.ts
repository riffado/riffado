import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

// Fumadocs source config. Content lives in `content/docs/` and is compiled
// at build time into `src/.source/` by the `fumadocs-mdx` CLI (wired into
// `next.config.ts` via `createMDX()` and the `postinstall` script in
// `package.json`). Raw MDX is NOT read at request time, so the Next.js
// standalone output doesn't need to trace `content/`.
export const docs = defineDocs({
    dir: "content/docs",
});

export default defineConfig({
    // `lastModified` reads `git log` for each MDX file and exports a
    // `lastModified` field on every page. It requires BOTH the `git`
    // binary on $PATH AND a `.git/` repo present at build time -- the
    // plugin spawns `git` unconditionally and propagates any error.
    // The Docker build satisfies both: the builder stage `apt-get`s
    // git (see Dockerfile) and `.git/` is no longer dockerignored
    // (see .dockerignore). The runner stage doesn't carry either, so
    // the published image stays slim. Consumers: `src/app/sitemap.ts`
    // (sitemap <lastmod>) and the docs page footer.
    plugins: [lastModified()],
    mdxOptions: {
        // Warm dual-theme shiki palette that lives close to the OpenPlaud
        // OKLCH tokens defined in `src/app/globals.css`. `vitesse-light`
        // sits well on the cream background; `vesper` matches the dark
        // mocha surface without the high-contrast neon of e.g. `dracula`.
        // The `.dark` class on `<html>` (driven by the app-wide theme
        // provider) flips between the two automatically.
        rehypeCodeOptions: {
            themes: {
                light: "vitesse-light",
                dark: "vesper",
            },
        },
    },
});
