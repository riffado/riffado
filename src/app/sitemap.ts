import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { source } from "@/lib/source";

// Sitemap currently lists docs pages only. The marketing landing and legal
// pages are mounted under hosted-only conditions (see comments in
// `src/components/landing-footer.tsx`); when those need indexing on
// hosted, extend this with explicit entries rather than letting it sniff
// the file system.
//
// `APP_URL` is required at runtime (see `src/lib/env.ts`) but allowed
// to be unset at build time so `next build` doesn't depend on production
// secrets. Forcing this route dynamic means `env.APP_URL` is read on the
// first request from the actual deployed environment -- if we let it stay
// static, a self-host Docker image built without APP_URL would ship a
// sitemap pinned to the `https://openplaud.com` fallback below. The
// fallback only kicks in for the genuinely-missing-at-runtime case (which
// the env validator already prevents in practice).
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = env.APP_URL ?? "https://openplaud.com";
    return source.getPages().map((page) => ({
        url: `${baseUrl}${page.url}`,
        // `lastModified` from the fumadocs-mdx `lastModified` plugin (see
        // `source.config.ts`). Undefined in Docker builds where `.git` is
        // absent, in which case crawlers fall back to their own heuristics.
        lastModified: page.data.lastModified,
        changeFrequency: "weekly",
        priority: 0.7,
    }));
}
