import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { source } from "@/lib/source";

// Sitemap currently lists docs pages only. The marketing landing and legal
// pages are mounted under hosted-only conditions (see comments in
// `src/components/landing-footer.tsx`); when those need indexing on
// hosted, extend this with explicit entries rather than letting it sniff
// the file system.
//
// `APP_URL` is required in non-build runtimes (see `src/lib/env.ts`).
// During `next build` the env validator allows it to be unset; the
// fallback keeps the build from crashing -- crawlers will see whatever
// the deployed runtime emits.
const BASE_URL = env.APP_URL ?? "https://openplaud.com";

export default function sitemap(): MetadataRoute.Sitemap {
    return source.getPages().map((page) => ({
        url: `${BASE_URL}${page.url}`,
        // `lastModified` from the fumadocs-mdx `lastModified` plugin (see
        // `source.config.ts`). Undefined in Docker builds where `.git` is
        // absent, in which case crawlers fall back to their own heuristics.
        lastModified: page.data.lastModified,
        changeFrequency: "weekly",
        priority: 0.7,
    }));
}
