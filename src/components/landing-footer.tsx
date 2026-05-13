import Link from "next/link";
import { Github, X } from "@/components/icons/icons";
import { Logo } from "@/components/icons/logo";

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

const COLUMNS: FooterColumn[] = [
    {
        title: "Product",
        links: [
            { label: "Features", href: "/#features" },
            { label: "Pricing", href: "/#pricing" },
            { label: "Self-host", href: "/#deploy" },
            {
                label: "Changelog",
                href: "https://github.com/openplaud/openplaud/blob/main/CHANGELOG.md",
                external: true,
            },
            {
                label: "Roadmap",
                href: "https://github.com/openplaud/openplaud/issues",
                external: true,
            },
        ],
    },
    {
        title: "Resources",
        links: [
            { label: "Documentation", href: "/docs" },
            { label: "Install script", href: "/install" },
            {
                label: "Discussions",
                href: "https://github.com/openplaud/openplaud/discussions",
                external: true,
            },
            {
                label: "Security",
                href: "https://github.com/openplaud/openplaud/blob/main/SECURITY.md",
                external: true,
            },
        ],
    },
    {
        title: "Company",
        links: [
            { label: "For Professionals", href: "/#for-professionals" },
            {
                label: "Open Source",
                href: "https://github.com/openplaud/openplaud",
                external: true,
            },
            {
                label: "Code of Conduct",
                href: "https://github.com/openplaud/openplaud/blob/main/CODE_OF_CONDUCT.md",
                external: true,
            },
            { label: "Contact", href: "mailto:support@openplaud.com" },
        ],
    },
    {
        title: "Legal",
        links: [
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            {
                label: "Security disclosure",
                href: "mailto:security@openplaud.com",
            },
            {
                label: "License (AGPL-3.0)",
                href: "https://www.gnu.org/licenses/agpl-3.0.html",
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
                <div className="grid grid-cols-2 md:grid-cols-6 gap-8 md:gap-12">
                    {/* Brand block spans 2 cols on desktop so the sitemap
                        sits cleanly to the right. */}
                    <div className="col-span-2 flex flex-col gap-4">
                        <Link
                            href="/"
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity w-fit"
                        >
                            <Logo className="size-7" />
                            <span className="text-lg font-bold tracking-tight font-mono">
                                OpenPlaud
                            </span>
                        </Link>
                        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                            Open-source companion for your Plaud device.
                            Self-host it or let us run it for you.
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                            <Link
                                href="https://github.com/openplaud/openplaud"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="OpenPlaud on GitHub"
                            >
                                <Github className="size-5" />
                            </Link>
                            <Link
                                href="https://x.com/openplaud"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="OpenPlaud on X"
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

                {/* Honesty rail. OpenPlaud's Slice 2 audience
                    (lawyers/journalists/regulated work) responds to
                    explicit disclaimers more than to vague trust
                    badges -- mirrors the FAQ's HIPAA answer. */}
                <div className="mt-16 pt-6 border-t border-border/40">
                    <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-2xl">
                        OpenPlaud is not HIPAA or SOC 2 certified. For regulated
                        work, self-host and plug in an AI provider that signs a
                        BAA you&apos;ve reviewed, or run a local model that
                        never leaves your machine.
                    </p>
                </div>

                <div className="mt-6 pt-6 border-t border-border/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground font-mono">
                        © {currentYear} OpenPlaud. Licensed under{" "}
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
                            href="https://github.com/openplaud/openplaud"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
                        >
                            GitHub
                        </Link>
                    </p>
                </div>
            </div>
        </footer>
    );
}
