import Link from "next/link";
import { LogoWordmark } from "@/components/icons/logo";
import { GitHubStarsPill } from "@/components/landing/github-stars-pill";
import { LandingNavMenu } from "@/components/landing/landing-nav-menu";
import { LandingNavMobile } from "@/components/landing/landing-nav-mobile";
import { MetalButton } from "@/components/metal-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function LandingNav() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
            <div className="container relative mx-auto flex h-16 items-center justify-between px-4">
                <Link
                    href="/"
                    className="flex items-center transition-opacity hover:opacity-80"
                    aria-label="Riffado"
                >
                    <LogoWordmark className="h-8 w-auto" />
                </Link>

                <div className="absolute left-1/2 -translate-x-1/2">
                    <LandingNavMenu />
                </div>

                <div className="flex items-center gap-3">
                    <GitHubStarsPill />
                    <ThemeToggle />
                    <LandingNavMobile />
                    <MetalButton
                        asChild
                        size="sm"
                        className="hidden border-primary/50 bg-primary text-primary-foreground shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_30%,transparent)] hover:bg-primary/90 md:inline-flex"
                    >
                        <Link href="/login">Login</Link>
                    </MetalButton>
                </div>
            </div>
        </header>
    );
}
