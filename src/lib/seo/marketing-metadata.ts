import type { Metadata } from "next";
import { isOgCardSlug } from "@/lib/seo/og-cards";

const SITE_NAME = "Riffado";
const TWITTER_HANDLE = "@riffadohq";
const HOME_CARD = "/og-home.png";

interface MarketingMetadataOptions {
    /** Full, crafted page title. Rendered verbatim (bypasses the root template). */
    title: string;
    /** Meta + OG/Twitter description. */
    description: string;
    /** Canonical path, leading slash (e.g. `/for-professionals`). */
    path: string;
    /** Override the OG/Twitter title when it should differ from `title`. */
    socialTitle?: string;
    /** Absolute path to a prebuilt social card, overriding the generated one. */
    ogImage?: string;
}

/**
 * Builds consistent metadata for hosted marketing pages: canonical URL,
 * OpenGraph, and Twitter card. Callers supply copy only. Crafted titles
 * are emitted as `absolute` so the root `%s · Riffado` template does not
 * double the brand.
 */
export function marketingMetadata({
    title,
    description,
    path,
    socialTitle,
    ogImage,
}: MarketingMetadataOptions): Metadata {
    const ogTitle = socialTitle ?? title;
    // Card selection: explicit override -> registered per-page card (keyed by
    // the path's slug) -> homepage default. Slugs are allowlisted in the
    // registry; the `/og/[slug]` route only renders those.
    const slug = path.replace(/^\//, "");
    const card = ogImage ?? (isOgCardSlug(slug) ? `/og/${slug}` : HOME_CARD);

    // Relative URLs resolve against `metadataBase`. Images are explicit per
    // page: Next replaces `openGraph` per segment, so inheritance is dropped.
    return {
        title: { absolute: title },
        description,
        alternates: { canonical: path },
        openGraph: {
            type: "website",
            siteName: SITE_NAME,
            url: path,
            title: ogTitle,
            description,
            images: [{ url: card, width: 1200, height: 630 }],
        },
        twitter: {
            card: "summary_large_image",
            site: TWITTER_HANDLE,
            creator: TWITTER_HANDLE,
            title: ogTitle,
            description,
            images: [card],
        },
    };
}
