/**
 * Fixed registry of dynamic social cards, keyed by route slug (the page
 * `path` without its leading slash). The value is the headline rendered onto
 * the card by `/og/[slug]`. This is the single source of truth for card
 * headlines and the allowlist of renderable slugs -- `generateStaticParams`
 * pre-renders exactly these, and unknown slugs 404. The homepage uses a
 * prebuilt static asset (`/og-home.png`), so it is intentionally absent.
 */
export const OG_CARDS = {
    "for-professionals": "For Professionals",
    changelog: "What's new",
    install: "Self-host in one command",
    rebrand: "OpenPlaud is now Riffado",
    updates: "Product updates",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
} as const;

export type OgCardSlug = keyof typeof OG_CARDS;

export function isOgCardSlug(slug: string): slug is OgCardSlug {
    return slug in OG_CARDS;
}
