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
    // `lastModified` field on every page. The plugin no-ops cleanly when
    // git history is missing, which is the case inside our Docker build
    // (`.git` is in `.dockerignore`) -- self-hosters running the published
    // image will see no timestamp. Dev and source-checkout builds get the
    // real value. If we ever want timestamps in the image, drop `.git`
    // from `.dockerignore`; cost is +a few MB of build context.
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
