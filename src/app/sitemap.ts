import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { source } from "@/lib/source";

// `force-dynamic` so `env.IS_HOSTED` / `env.APP_URL` are read at request
// time, not bake time.
export const dynamic = "force-dynamic";

// Public, indexable static routes served only by the hosted product.
// Docs pages are appended separately from the Fumadocs source. Private
// surfaces (app, auth, admin, api) are intentionally absent and are also
// disallowed in `robots.ts`.
const STATIC_ROUTES: {
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}[] = [
    { path: "/", priority: 1.0, changeFrequency: "daily" },
    { path: "/changelog", priority: 0.8, changeFrequency: "daily" },
    { path: "/install", priority: 0.7, changeFrequency: "weekly" },
    { path: "/rebrand", priority: 0.5, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
    // Self-host instances are not crawled (see `robots.ts` -- `Disallow: /`),
    // so they expose no sitemap entries. The sitemap is a hosted-only surface.
    if (!env.IS_HOSTED) {
        return [];
    }

    const baseUrl = env.APP_URL ?? "https://mesynx-ai.com";

    const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
        url: `${baseUrl}${route.path}`,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
    }));

    const docsEntries: MetadataRoute.Sitemap = source
        .getPages()
        .map((page) => ({
            url: `${baseUrl}${page.url}`,
            lastModified: page.data.lastModified,
            changeFrequency: "weekly",
            priority: 0.7,
        }));

    return [...staticEntries, ...docsEntries];
}
