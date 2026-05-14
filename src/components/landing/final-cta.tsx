import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { MetalButton } from "@/components/metal-button";

export function FinalCTA() {
    return (
        <section className="container mx-auto px-4 py-24 md:py-32">
            <div className="max-w-3xl mx-auto text-center">
                <h2 className="text-3xl md:text-5xl font-semibold tracking-tight mb-6">
                    Stop renting your own voice.
                </h2>
                <p className="text-muted-foreground text-lg leading-relaxed mb-10 max-w-xl mx-auto">
                    Your Plaud Note already works. OpenPlaud gives you the rest
                    of it: transcription, search, export, and a choice about
                    where it all lives.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                    <Link href="/register" className="w-full sm:w-auto">
                        <MetalButton
                            size="lg"
                            className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-12 px-6 shadow-[0_0_20px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
                        >
                            Start free <ArrowRight className="size-4" />
                        </MetalButton>
                    </Link>
                    <Link
                        href="https://github.com/openplaud/openplaud"
                        target="_blank"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4"
                    >
                        or read the code first →
                    </Link>
                </div>
            </div>
        </section>
    );
}
