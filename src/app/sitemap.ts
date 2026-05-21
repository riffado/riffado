import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { source } from "@/lib/source";

// `force-dynamic` so `env.APP_URL` is read at request time, not bake time.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = env.APP_URL ?? "https://openplaud.com";
    return source.getPages().map((page) => ({
        url: `${baseUrl}${page.url}`,
        lastModified: page.data.lastModified,
        changeFrequency: "weekly",
        priority: 0.7,
    }));
}
