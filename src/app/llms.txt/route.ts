import { llms } from "fumadocs-core/source/llms";
import { source } from "@/lib/source";

const index = llms(source);

export function GET() {
    return new Response(index.index(), {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
    });
}
