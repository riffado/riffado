import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";

interface RouteContext {
    params: Promise<{ slug: string[] }>;
}

// Per-doc OG image, generated on-demand via `next/og` (`@vercel/og` under
// the hood). The URL shape is `/docs-og/<slug-path>.png` -- see
// `generateMetadata` in `src/app/(docs)/docs/[[...slug]]/page.tsx` for the
// reverse mapping.
//
// We strip the trailing `.png` from the last slug segment, then look the
// page up through the same fumadocs `source` the docs pages use. This
// keeps slugs and OG URLs in lockstep automatically.
//
// `generateOGImage` returns an `ImageResponse`, which Next.js handles by
// streaming the rendered PNG. Image caching is left to the platform's
// default headers -- the route output is deterministic per build.
export async function GET(_req: Request, { params }: RouteContext) {
    const { slug } = await params;
    if (slug.length === 0) notFound();

    const last = slug[slug.length - 1];
    if (!last.endsWith(".png")) notFound();

    const pageSlug = [...slug.slice(0, -1), last.replace(/\.png$/, "")];
    // The docs landing (`/docs`) is keyed as an empty slug array in the
    // fumadocs source; we shape `/docs-og/index.png` for that case in
    // `generateMetadata`, so reverse it here.
    const lookupSlug =
        pageSlug.length === 1 && pageSlug[0] === "index" ? [] : pageSlug;

    const page = source.getPage(lookupSlug);
    if (!page) notFound();

    return generateOGImage({
        title: page.data.title,
        description: page.data.description,
        site: "OpenPlaud",
        // Match the OpenPlaud primary token (warm terracotta). Hardcoded as
        // a literal because the OG runtime is the edge ImageResponse
        // environment -- it can't read CSS custom properties from
        // `globals.css`. Keep this in sync if the brand color shifts.
        primaryColor: "oklch(0.6171 0.1375 39.0427)",
        primaryTextColor: "oklch(1 0 0)",
    });
}

export function generateStaticParams() {
    return source.getPages().map((page) => ({
        // Mirror the slug shape produced in `generateMetadata`: empty
        // slug -> `index.png`, otherwise `<...slug>.png` on the last segment.
        slug:
            page.slugs.length === 0
                ? ["index.png"]
                : [
                      ...page.slugs.slice(0, -1),
                      `${page.slugs[page.slugs.length - 1]}.png`,
                  ],
    }));
}
