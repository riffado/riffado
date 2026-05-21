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
                        a: createRelativeLink(source, page),
                    })}
                />
            </DocsBody>
        </DocsPage>
    );
}

export function generateStaticParams() {
    return source.generateParams();
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const page = source.getPage(slug);
    if (!page) notFound();

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
