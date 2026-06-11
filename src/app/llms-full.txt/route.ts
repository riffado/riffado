import { source } from "@/lib/source";

export function GET() {
    const lines: string[] = ["# Riffado docs", ""];

    for (const page of source.getPages()) {
        lines.push(`## ${page.data.title}`);
        lines.push(`URL: ${page.url}`);
        if (page.data.description) {
            lines.push("");
            lines.push(page.data.description);
        }
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
