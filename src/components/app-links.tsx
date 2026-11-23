"use client";

import { BookOpen, Bug, Code, ScrollText } from "lucide-react";
import { ReportBugButton } from "@/components/report-bug-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    AGPL_LICENSE_URL,
    APP_RELEASE_URL,
    APP_SOURCE_URL,
    APP_VERSION,
} from "@/lib/version";

const LINKS = [
    { label: "Docs", href: "/docs", icon: BookOpen },
    { label: "Changelog", href: "/changelog", icon: ScrollText },
] as const;

const linkClass =
    "rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Docs, Changelog, Report a bug and Source code as account menu items.
 * Report a bug calls `onReportBug`, so the dialog can live outside the
 * menu and stay open after it closes.
 */
export function AppLinksMenuItems({
    onReportBug,
}: {
    onReportBug: () => void;
}) {
    return (
        <>
            {LINKS.map(({ label, href, icon: Icon }) => (
                <DropdownMenuItem key={label} asChild>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                        <Icon />
                        {label}
                    </a>
                </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={onReportBug}>
                <Bug />
                Report a bug
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
                <a
                    href={APP_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <Code />
                    Source code
                </a>
            </DropdownMenuItem>
        </>
    );
}

/** "Riffado 0.7.1 · AGPL-3.0": version linked to its release notes, licence linked. */
export function AppVersionLine({ className }: { className?: string }) {
    return (
        <p className={cn("text-xs text-muted-foreground", className)}>
            <a
                href={APP_RELEASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                aria-label={`Release notes for Riffado ${APP_VERSION}`}
            >
                Riffado {APP_VERSION}
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
 * One quiet line with the same links, for screens without an account
 * menu (Settings, the standalone recording page). Keeps the AGPL source
 * offer reachable from every signed-in page.
 */
export function AppLinksLine({
    isHosted,
    className,
}: {
    isHosted: boolean;
    className?: string;
}) {
    return (
        <nav
            aria-label="About Riffado"
            className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground select-none",
                className,
            )}
        >
            {LINKS.map(({ label, href }) => (
                <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClass}
                >
                    {label}
                </a>
            ))}
            <ReportBugButton isHosted={isHosted} className={linkClass} />
            <a
                href={APP_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
            >
                Source code
            </a>
            <AppVersionLine />
        </nav>
    );
}
