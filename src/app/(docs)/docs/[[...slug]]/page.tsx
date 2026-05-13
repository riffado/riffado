import { createRelativeLink } from "fumadocs-ui/mdx";
import {
    DocsBody,
    DocsDescription,
    DocsPage,
    DocsTitle,
} from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

interface PageProps {
    params: Promise<{ slug?: string[] }>;
}

// GitHub repo coordinates for the `editOnGithub` prop. Always tracks
// `main` because docs reflect tip-of-tree (see plan: no versioning).
// Self-hosters on a pinned tag are reading their tag's bundled docs; the
// edit link is still aimed at where contributions go, not at the tag.
const GITHUB_OWNER = "openplaud";
const GITHUB_REPO = "openplaud";

export default async function Page({ params }: PageProps) {
    const { slug } = await params;
    const page = source.getPage(slug);
    if (!page) notFound();

    const MDX = page.data.body;
    const lastModified = page.data.lastModified;

    return (
        <DocsPage
            toc={page.data.toc}
            full={page.data.full}
            // `editOnGithub` + `lastUpdate` use Fumadocs' dedicated page
            // slots, which render as a small inline link + timestamp under
            // the body -- not the full-width block the `footer.children`
            // slot would produce. `lastUpdate` is undefined inside the
            // Docker image because `.git` is dockerignored; Fumadocs
            // simply doesn't render the timestamp in that case.
            editOnGithub={{
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                sha: "main",
                path: `content/docs/${page.path}`,
            }}
            lastUpdate={lastModified}
        >
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription>{page.data.description}</DocsDescription>
            <DocsBody>
                <MDX
                    components={getMDXComponents({
                        // Rewrites relative MDX links (e.g. `./encryption`)
                        // into route-correct URLs so authors don't have to
                        // hardcode `/docs/...` paths. Resilient to IA moves.
                        a: createRelativeLink(source, page),
                    })}
                />
            </DocsBody>
        </DocsPage>
    );
}

// Pre-render every doc at build time. Fumadocs pages are static -- there's
// no per-user data, no auth, no cookies -- so SSG is the right default.
export function generateStaticParams() {
    return source.generateParams();
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const page = source.getPage(slug);
    if (!page) notFound();

    // Per-page OG image rendered by `src/app/docs-og/[...slug]/route.tsx`.
    // The slug is appended as `.png` so the same `[...slug]` shape works
    // for both the page and its OG endpoint. See that file for the actual
    // ImageResponse.
    const ogSegments = (page.slugs.length ? page.slugs : ["index"]).join("/");
    const ogImage = `/docs-og/${ogSegments}.png`;

    return {
        title: page.data.title,
        description: page.data.description,
        openGraph: {
            title: page.data.title,
            description: page.data.description,
            type: "article",
            images: [ogImage],
        },
        twitter: {
            card: "summary_large_image",
            title: page.data.title,
            description: page.data.description,
            images: [ogImage],
        },
    };
}
