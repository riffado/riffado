import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LogoWordmark } from "@/components/icons/logo";
import { DotWaveformBand } from "@/components/ui/dot-waveform-band";
import { cn } from "@/lib/utils";
import { AGPL_LICENSE_URL, APP_SOURCE_URL } from "@/lib/version";

interface AuthShellProps {
    /**
     * `tall` pins the column higher (60px instead of 150px from the top on
     * wide screens) for long forms such as Create account.
     */
    offset?: "default" | "tall";
    /** Column width; `wide` (440px) suits a longer title. */
    width?: "default" | "wide";
    children: ReactNode;
}

/**
 * Page frame for sign-in, account creation, password reset and the
 * suspended notice: a quiet page, the wordmark top left, one column pinned
 * to the top and the dot-waveform band along the bottom.
 */
export function AuthShell({
    offset = "default",
    width = "default",
    children,
}: AuthShellProps) {
    return (
        <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background">
            <header className="flex shrink-0 items-center px-5 py-3 sm:px-10 sm:py-8">
                <Link
                    href="/"
                    aria-label="Riffado"
                    className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <LogoWordmark className="h-5 w-auto text-strong" />
                </Link>
            </header>
            <main
                className={cn(
                    "flex flex-1 justify-center px-5 pt-10 pb-40",
                    offset === "tall" ? "sm:pt-15" : "sm:pt-37.5",
                )}
            >
                <div
                    className={cn(
                        "flex w-full flex-col gap-7 sm:gap-8",
                        width === "wide" ? "max-w-110" : "max-w-100",
                    )}
                >
                    {children}
                    <AuthSourceLine />
                </div>
            </main>
            <DotWaveformBand className="absolute inset-x-0 -bottom-7.5 -z-10 sm:bottom-0" />
        </div>
    );
}

/**
 * "Source code · AGPL-3.0", quiet under the form: the AGPL network-use
 * source offer for visitors who aren't signed in.
 */
function AuthSourceLine() {
    const linkClass =
        "rounded-sm outline-none hover:text-subtle focus-visible:ring-[3px] focus-visible:ring-ring/50";
    return (
        <p className="pt-2 text-center text-xs text-muted-foreground select-none">
            <a
                href={APP_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
            >
                Source code
            </a>
            <span aria-hidden="true"> · </span>
            <a
                href={AGPL_LICENSE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
            >
                AGPL-3.0
            </a>
        </p>
    );
}

/**
 * Page title and an optional line under it: `quiet` for a one-line
 * subtitle, `body` (default) for an explanation the reader needs.
 */
export function AuthHeading({
    title,
    tone = "body",
    children,
}: {
    title: string;
    tone?: "body" | "quiet";
    children?: ReactNode;
}) {
    return (
        <div
            className={cn(
                "flex flex-col",
                children && tone === "body" ? "gap-3.5" : "gap-2.5",
            )}
        >
            <h1 className="font-display text-document-title-compact font-medium text-strong sm:text-page-title">
                {title}
            </h1>
            {children ? (
                <p
                    className={cn(
                        "text-base",
                        tone === "quiet" ? "text-subtle" : "text-foreground",
                    )}
                >
                    {children}
                </p>
            ) : null}
        </div>
    );
}

/** An inline text link on the auth pages ("Create an account"). */
export function AuthLink({ className, ...props }: ComponentProps<typeof Link>) {
    return (
        <Link
            className={cn(
                "rounded-sm text-sm font-medium text-strong underline decoration-input decoration-1 underline-offset-3 outline-none hover:decoration-current focus-visible:ring-[3px] focus-visible:ring-ring/50",
                className,
            )}
            {...props}
        />
    );
}

/** A link inside an error line ("reset your password"). */
export function ErrorLink({
    href,
    children,
}: {
    href: string;
    children: ReactNode;
}) {
    return (
        <AuthLink href={href} className="text-small decoration-current">
            {children}
        </AuthLink>
    );
}

/** A prompt and its link, centred: "New here? Create an account". */
export function AuthSwitch({
    prompt,
    href,
    children,
}: {
    prompt: string;
    href: string;
    children: ReactNode;
}) {
    return (
        <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-subtle">
            {prompt}
            <AuthLink href={href}>{children}</AuthLink>
        </p>
    );
}

/** Hosted-only consent line under the sign-in and sign-up forms. */
export function AuthTerms() {
    return (
        <p className="text-center text-small text-muted-foreground">
            By continuing you agree to the{" "}
            <Link
                href="/terms"
                className="text-subtle underline decoration-1 underline-offset-3 hover:text-strong"
            >
                Terms
            </Link>{" "}
            and{" "}
            <Link
                href="/privacy"
                className="text-subtle underline decoration-1 underline-offset-3 hover:text-strong"
            >
                Privacy Policy
            </Link>
        </p>
    );
}
