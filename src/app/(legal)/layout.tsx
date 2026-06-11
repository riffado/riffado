import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoWordmark } from "@/components/icons/logo";
import { LandingFooter } from "@/components/landing-footer";
import { env } from "@/lib/env";

/**
 * Layout for the legal route group (`/privacy`, `/terms`). Deliberately
 * separate from `(app)` -- legal pages are linked from the public
 * landing footer, so they must render for signed-out visitors without
 * any in-app chrome (no sidebar, no auth-required wrappers).
 *
 * Hosted-only by design. These pages describe the terms of the hosted
 * service we operate; on a self-host instance there is no "we" running
 * a service, so the docs simply don't apply -- 404 rather than serve
 * misleading legal text. Centralizing the `notFound()` check at the
 * layout means every route in the group inherits the guard with one
 * line.
 */
export default function LegalLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    if (!env.IS_HOSTED) {
        notFound();
    }

    return (
        <div className="flex flex-col min-h-[100vh]">
            <header className="border-b border-border/40">
                <div className="container mx-auto px-4 max-w-3xl flex h-16 items-center">
                    <Link
                        href="/"
                        className="flex items-center hover:opacity-80 transition-opacity"
                        aria-label="Riffado"
                    >
                        <LogoWordmark className="h-7 w-auto" />
                    </Link>
                </div>
            </header>
            <main className="flex-1">
                <article className="container mx-auto px-4 max-w-3xl py-16 md:py-24 [&_h1]:text-3xl [&_h1]:md:text-4xl [&_h1]:font-bold [&_h1]:font-mono [&_h1]:tracking-tight [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:font-mono [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-3 [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4 [&_a]:text-foreground [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 [&_a]:hover:text-foreground/80 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:text-muted-foreground [&_ul]:mb-4 [&_li]:mb-1">
                    {children}
                </article>
            </main>
            <LandingFooter />
        </div>
    );
}
