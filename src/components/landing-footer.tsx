import Link from "next/link";
import { Github, X } from "@/components/icons/icons";
import { LogoWordmark } from "@/components/icons/logo";

/**
 * Marketing footer for hosted public surfaces. Currently mounted on:
 *   - `/`                           (`src/app/page.tsx`)
 *   - `/install` (hosted branch)    (`src/app/install/page.tsx`)
 *   - `/privacy`, `/terms`          (`src/app/(legal)/layout.tsx`)
 *
 * Intentionally not used by `src/app/(app)/layout.tsx` -- signed-in
 * users get the minimal `Footer` (AppFooter) from `./footer.tsx`
 * instead. Splitting them keeps app chrome from inheriting marketing-
 * sitemap weight, and keeps marketing free to grow columns without
 * bloating every workstation screen.
 *
 * Every call site that mounts this component is hosted-only -- either
 * by virtue of `src/app/page.tsx` redirecting to `/login` when
 * `IS_HOSTED` is unset, the `(legal)` layout calling `notFound()` on
 * self-host, or `/install` branching on `env.IS_HOSTED` to render
 * `Footer` instead. The component itself therefore never needs to
 * internally branch on hosted/self-host; new call sites must keep
 * this invariant.
 */

type FooterLink = {
    label: string;
    href: string;
    external?: boolean;
};

type FooterColumn = {
    title: string;
    links: FooterLink[];
};

// Recombined to three columns (Product / Community / Legal) after
// dropping three duplicate links -- "Open Source" (covered by the
// brand-block GitHub icon), "License (AGPL-3.0)" (covered by the
// copyright row), and "Install script" (covered by Product → Self-host).
// "For Professionals" moved from Company to Product where the
// audience/page actually lives.
const COLUMNS: FooterColumn[] = [
    {
        title: "Product",
        links: [
            { label: "Features", href: "/#features" },
            { label: "Pricing", href: "/#pricing" },
            { label: "Self-host", href: "/#deploy" },
            { label: "For Professionals", href: "/#for-professionals" },
            { label: "Changelog", href: "/changelog" },
            {
                label: "Roadmap",
                href: "https://github.com/mesynx-ai/mesynx-ai/issues",
                external: true,
            },
        ],
    },
    {
        title: "Community",
        links: [
            { label: "Documentation", href: "https://mesynx.r0073dl053r.com/" },
            {
                label: "Discussions",
                href: "https://github.com/r0073d-l053r/mesynx/discussions",
                external: true,
            },
            {
                label: "Code of Conduct",
                href: "https://github.com/r0073d-l053r/mesynx/blob/main/CODE_OF_CONDUCT.md",
                external: true,
            },
            {
                label: "Discord",
                href: "https://discord.gg/mgBKaEGUvc",
                external: true,
            },
        ],
    },
    {
        title: "Legal",
        links: [
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            {
                label: "Security",
                href: "https://github.com/mesynx-ai/mesynx-ai/blob/main/SECURITY.md",
                external: true,
            },
            {
                label: "Security advisory",
                href: "https://github.com/r0073d-l053r/mesynx/security/advisories/new",
                external: true,
            },
        ],
    },
];

function FooterLinkItem({ label, href, external }: FooterLink) {
    const externalProps = external
        ? { target: "_blank", rel: "noopener noreferrer" as const }
        : {};
    return (
        <li>
            <Link
                href={href}
                {...externalProps}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                {label}
            </Link>
        </li>
    );
}

export function LandingFooter() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t border-border/40 bg-background">
            <div className="container mx-auto px-4 py-16 md:py-20 max-w-7xl">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-12">
                    {/* Brand block spans 2 cols on desktop so the three
                        sitemap columns sit cleanly to the right. */}
                    <div className="col-span-2 flex flex-col gap-4">
                        <Link
                            href="/"
                            className="flex items-center hover:opacity-80 transition-opacity w-fit"
                            aria-label="Mesynx AI"
                        >
                            <LogoWordmark className="h-7 w-auto" />
                        </Link>
                        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                            Open-source transcription for the voice recorder you
                            already own. Your recordings, your transcripts,
                            yours to keep.
                        </p>
            <div className="flex items-center gap-3 mt-1">
                <Link
                    href="https://github.com/r0073d-l053r/mesynx"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Mesynx AI on GitHub"
                >
                    <Github className="size-5" />
                </Link>
                            <Link
                                href="https://x.com/mesynx-aihq"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="Mesynx AI on X"
                            >
                                <X className="size-[18px]" />
                            </Link>
                        </div>
                    </div>

                    {COLUMNS.map((col) => (
                        <div key={col.title} className="flex flex-col gap-3">
                            <h3 className="text-xs font-semibold font-mono uppercase tracking-wider text-foreground/80">
                                {col.title}
                            </h3>
                            <ul className="flex flex-col gap-2">
                                {col.links.map((link) => (
                                    <FooterLinkItem
                                        key={link.label}
                                        {...link}
                                    />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Honesty rail + copyright share one top border. The
                    honesty rail is the trust signal Mesynx AI's Slice 2
                    audience (lawyers/journalists/regulated work)
                    actually responds to -- mirrors the FAQ's HIPAA
                    answer. Previously these sat under two adjacent
                    rules ~30px apart; merged into one block to quiet
                    the bottom of the page. */}
                <div className="mt-16 pt-6 border-t border-border/40 flex flex-col gap-6">
                    <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-2xl">
                        Mesynx AI is not HIPAA or SOC 2 certified. For regulated
                        work, self-host and plug in an AI provider that signs a
                        BAA you&apos;ve reviewed, or run a local model that
                        never leaves your machine.
                    </p>
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <p className="text-xs text-muted-foreground font-mono">
                            © {currentYear} Mesynx AI. Licensed under{" "}
                            <Link
                                href="https://www.gnu.org/licenses/agpl-3.0.html"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground/80 hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                            >
                                AGPL-3.0
                            </Link>
                            .
                        </p>
                        <p className="text-xs text-muted-foreground/70 font-mono">
                            Built in the open on{" "}
                            <Link
                                href="https://github.com/mesynx-ai/mesynx-ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                            >
                                GitHub
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </footer>
    );
}
