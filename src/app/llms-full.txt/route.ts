import { source } from "@/lib/source";

// Flattened full-content variant of `/llms.txt`. Concatenates every doc's
// raw markdown body so readers (humans or LLMs) can ingest the whole
// surface in a single fetch. Fumadocs exposes the processed markdown on
// `page.data._markdown` when `includeProcessedMarkdown` is enabled in the
// MDX postprocess pipeline -- we let it stay disabled and fall back to the
// page title + description + URL when no body markdown is available, since
// the corpus is small and pure-prose ingestion is the goal.
//
// Kept as a separate route from `/llms.txt` because that file follows the
// llmstxt.org spec (index only); concatenated full text is a de-facto
// extension, not the spec.
export function GET() {
    const lines: string[] = ["# OpenPlaud docs", ""];

    for (const page of source.getPages()) {
        lines.push(`## ${page.data.title}`);
        lines.push(`URL: ${page.url}`);
        if (page.data.description) {
            lines.push("");
            lines.push(page.data.description);
        }
        // `_markdown` only present when the MDX pipeline is configured to
        // export it; treat as best-effort.
        const md = (page.data as { _markdown?: string })._markdown;
        if (md) {
            lines.push("");
            lines.push(md);
        }
        lines.push("");
        lines.push("---");
        lines.push("");
    }

    return new Response(lines.join("\n"), {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
    });
}
