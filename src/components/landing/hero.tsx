import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { MetalButton } from "@/components/metal-button";

export function Hero() {
    return (
        <section className="relative pt-24 pb-20 md:pt-40 md:pb-32 overflow-hidden">
            {/* Soft radial anchor behind the type. Uses the fixed color-mix
                primary token from the earlier glow refactor. */}
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_40%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]" />

            <div className="container mx-auto px-4">
                <div className="max-w-4xl mx-auto text-center">
                    <h1 className="text-[clamp(2.5rem,6.5vw,5.5rem)] font-semibold tracking-[-0.02em] leading-[1.02] mb-8 text-foreground">
                        Plaud charges{" "}
                        <span className="text-muted-foreground/70 line-through decoration-[0.08em] decoration-muted-foreground/40">
                            $29.99
                        </span>
                        /month.
                        <br />
                        We charge <span className="text-primary">$0</span>.
                    </h1>

                    <p className="max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground leading-relaxed mb-10">
                        OpenPlaud connects to your Plaud Note and transcribes
                        with your own AI keys. Pennies per hour, instead of a
                        subscription. Self-host free, or hosted from{" "}
                        <span className="text-foreground font-medium">
                            $0/mo
                        </span>
                        .
                    </p>

                    <div className="flex justify-center mb-10">
                        <MetalButton
                            asChild
                            size="lg"
                            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50 h-12 px-7 text-base shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
                        >
                            <Link href="/register">
                                Start free <ArrowRight className="size-4" />
                            </Link>
                        </MetalButton>
                    </div>

                    <TrustRow />
                </div>
            </div>
        </section>
    );
}

function TrustRow() {
    const items = [
        "Works with Plaud Note, Note Pro & NotePin",
        "Open source",
        "AGPL-3.0",
    ];
    return (
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {items.map((item, i) => (
                <li
                    key={item}
                    className="flex items-center gap-x-5 tracking-wide"
                >
                    <span>{item}</span>
                    {i < items.length - 1 && (
                        <span
                            aria-hidden="true"
                            className="size-1 rounded-full bg-muted-foreground/40"
                        />
                    )}
                </li>
            ))}
        </ul>
    );
}
