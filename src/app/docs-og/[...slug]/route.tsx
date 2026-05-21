import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";

interface RouteContext {
    params: Promise<{ slug: string[] }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
    const { slug } = await params;
    if (slug.length === 0) notFound();

    const last = slug[slug.length - 1];
    if (!last.endsWith(".png")) notFound();

    const pageSlug = [...slug.slice(0, -1), last.replace(/\.png$/, "")];
    // `/docs` is keyed as `[]` in fumadocs; reversed from `index.png` here.
    const lookupSlug =
        pageSlug.length === 1 && pageSlug[0] === "index" ? [] : pageSlug;

    const page = source.getPage(lookupSlug);
    if (!page) notFound();

    return generateOGImage({
        title: page.data.title,
        description: page.data.description,
        site: "OpenPlaud",
        // sRGB of `oklch(0.6171 0.1375 39.0427)` from globals.css. Satori
        // (next/og renderer) does not support `oklch()`; keep both in sync.
        primaryColor: "#c96442",
        primaryTextColor: "#ffffff",
    });
}

export function generateStaticParams() {
    return source.getPages().map((page) => ({
        slug:
            page.slugs.length === 0
                ? ["index.png"]
                : [
                      ...page.slugs.slice(0, -1),
                      `${page.slugs[page.slugs.length - 1]}.png`,
                  ],
    }));
}
