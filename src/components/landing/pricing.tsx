import { Check } from "lucide-react";
import Link from "next/link";
import { MetalButton } from "@/components/metal-button";

// NOTE: Hosted Free caps below are sensible placeholders. Adjust as
// hosted-infra economics settle. Self-host tier is genuinely uncapped.
const TIERS = [
    {
        name: "Self-host",
        price: "Free",
        priceSuffix: "forever",
        tagline: "Your machine. Your rules.",
        features: [
            "Unlimited recordings",
            "Unlimited storage on your disk or your S3",
            "Bring your own AI keys",
            "Every feature, no gates",
            "AGPL-3.0 source",
        ],
        cta: { label: "Deploy with Docker", href: "#deploy" },
        emphasis: false,
    },
    {
        name: "Hosted Free",
        price: "$0",
        priceSuffix: "/month",
        tagline: "Try it in a minute, no card.",
        features: [
            "500 minutes of transcription / month",
            "10 GB storage",
            "Bring your own AI keys",
            "Sync from one Plaud device",
            "Upgrade any time",
        ],
        cta: { label: "Start free", href: "/register" },
        emphasis: false,
    },
    {
        name: "Hosted Pro",
        price: "$5",
        priceSuffix: "/month",
        tagline: "Everything, unlimited.",
        features: [
            "Unlimited transcription minutes",
            "Unlimited storage",
            "Bring your own AI keys",
            "Unlimited devices",
            "Priority sync, backups, support",
        ],
        cta: { label: "Start Pro", href: "/register?plan=pro" },
        emphasis: true,
    },
];

export function Pricing() {
    return (
        <section id="pricing" className="py-24 md:py-32">
            <div className="container mx-auto px-4">
                <div className="max-w-3xl mx-auto text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
                        Pick the version that fits you.
                    </h2>
                    <p className="text-muted-foreground text-lg leading-relaxed">
                        All three give you the same product. The only difference
                        is who runs the server and how much you care about
                        thinking about it.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                    {TIERS.map((tier) => (
                        <div
                            key={tier.name}
                            className={`rounded-2xl border p-6 md:p-8 flex flex-col ${
                                tier.emphasis
                                    ? "border-primary/50 bg-card shadow-[0_0_40px_color-mix(in_oklch,var(--primary)_12%,transparent)]"
                                    : "border-border bg-card"
                            }`}
                        >
                            <div className="mb-6">
                                <div className="text-sm font-semibold tracking-wide mb-2">
                                    {tier.name}
                                </div>
                                <div className="flex items-baseline gap-2 mb-2">
                                    <span className="text-4xl font-bold tracking-tight tabular-nums">
                                        {tier.price}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                        {tier.priceSuffix}
                                    </span>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {tier.tagline}
                                </p>
                            </div>

                            <ul className="space-y-3 mb-8 flex-1">
                                {tier.features.map((f) => (
                                    <li
                                        key={f}
                                        className="flex items-start gap-3 text-sm"
                                    >
                                        <div className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                                            <Check className="size-3" />
                                        </div>
                                        <span className="leading-snug">
                                            {f}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            <MetalButton
                                asChild
                                size="lg"
                                className={`w-full ${
                                    tier.emphasis
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50"
                                        : "bg-background/50"
                                }`}
                                variant={tier.emphasis ? undefined : "default"}
                            >
                                <Link href={tier.cta.href}>
                                    {tier.cta.label}
                                </Link>
                            </MetalButton>
                        </div>
                    ))}
                </div>

                <div className="mt-12 max-w-3xl mx-auto">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-5 text-sm text-muted-foreground">
                        <p className="leading-relaxed">
                            <span className="font-medium text-foreground">
                                For comparison:
                            </span>{" "}
                            Plaud Pro is{" "}
                            <span className="tabular-nums">$17.99/month</span>{" "}
                            for 1,200 minutes. Plaud Unlimited is{" "}
                            <span className="tabular-nums">$29.99/month</span>.
                            OpenPlaud Hosted Pro gives you the same unlimited
                            ceiling for <span className="tabular-nums">$5</span>
                            , and you pay AI providers directly instead of
                            paying us to mark them up.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
