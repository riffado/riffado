import { ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Homepage teaser for the professional / sovereignty audience
 * (Slice 2 in AGENTS.md). Deliberately concise: the full argument --
 * custody ledger, per-profession scenarios, honest boundaries --
 * lives on the dedicated `/for-professionals` page. This section's
 * only job is to signal "this product takes your obligations
 * seriously" and hand off.
 *
 * The `id` is kept for legacy `/#for-professionals` anchor links.
 */
export function ForProfessionals() {
    return (
        <section
            id="for-professionals"
            className="py-20 bg-secondary/20 border-y border-border/40"
        >
            <div className="container mx-auto px-4">
                <div className="max-w-5xl mx-auto">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono uppercase tracking-wider mb-4 text-muted-foreground">
                        <span>For professionals</span>
                        <span aria-hidden className="text-muted-foreground/40">
                            {"//"}
                        </span>
                        <span className="text-muted-foreground/80">
                            Lawyers · Journalists · Consultants · Researchers
                        </span>
                    </div>

                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-5 max-w-3xl text-balance">
                        If your conversations stay in the room, your recordings
                        should too.
                    </h2>

                    <p className="text-muted-foreground text-lg leading-relaxed text-pretty max-w-2xl mb-8">
                        Keep recordings and local AI on infrastructure you
                        control without becoming your own infrastructure team.
                        We can help plan and deploy Riffado on-premises for your
                        practice, newsroom, consultancy, or lab.
                    </p>

                    <Link
                        href="/for-professionals"
                        className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium"
                    >
                        Explore on-premises Riffado
                        <ArrowRight className="size-4" />
                    </Link>
                </div>
            </div>
        </section>
    );
}
