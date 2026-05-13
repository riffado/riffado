import { llms } from "fumadocs-core/source/llms";
import { source } from "@/lib/source";

// Standard `llms.txt` (https://llmstxt.org/) -- a small markdown index of
// the docs surface, hand-shippable into Claude/ChatGPT/etc. Our audience
// overlaps heavily with people pasting docs into LLMs, so this is high
// signal for low cost. For the flattened full-content variant see
// `src/app/llms-full.txt/route.ts`.
const index = llms(source);

export function GET() {
    return new Response(index.index(), {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            // Cache aggressively at the CDN; route output only changes
            // when the deployed build does.
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
    });
}
