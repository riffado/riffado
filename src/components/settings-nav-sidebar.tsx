"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { useEffect, useState } from "react";
import { AppLinksLine } from "@/components/app-links";
import type { NavItem } from "@/components/settings-nav-config";
import { touchTargetClass } from "@/components/ui/button";
import { libraryLocation } from "@/lib/library-location";
import { cn } from "@/lib/utils";
import type { SettingsPage } from "@/types/settings";

/**
 * "‹ Library" link back to the dashboard, at the top of the settings nav.
 * Returns to the recording the library last had open in this tab.
 */
export function LibraryBackLink({ onNavigate }: { onNavigate?: () => void }) {
    const [href, setHref] = useState("/dashboard");
    useEffect(() => {
        setHref(libraryLocation());
    }, []);
    return (
        <Link
            href={href}
            onClick={onNavigate}
            className={cn(
                "squircle relative flex h-7 w-fit items-center gap-1.5 rounded-[var(--radius-small)] pr-2 pl-1.5 text-ui font-medium text-subtle outline-none select-none hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50",
                touchTargetClass,
            )}
        >
            <ChevronLeft className="size-4.5" aria-hidden="true" />
            Library
        </Link>
    );
}

/**
 * Label that keeps the width of its semibold version, so the active item
 * changes weight without nudging anything (states change paint, not size).
 */
function StableLabel({ children }: { children: string }) {
    return (
        <span className="grid">
            <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 font-semibold"
            >
                {children}
            </span>
            <span className="col-start-1 row-start-1">{children}</span>
        </span>
    );
}

interface Props {
    nav: NavItem[];
    activePage: SettingsPage | null;
    onSelect: (page: SettingsPage) => void;
    onNavKeyDown: (e: React.KeyboardEvent) => void;
    onLeave?: () => void;
    /** Picks the bug-report channels in the links line at the bottom. */
    isHosted: boolean;
    className?: string;
}

/**
 * Settings sidebar (lg and up): back link, title and one item per page,
 * with the about links (docs, source code, licence) at the bottom.
 * Replaces the library sidebar while Settings is open. Arrow keys move
 * between items (handled by `onNavKeyDown`), Enter opens one.
 */
export function SettingsNavSidebar({
    nav,
    activePage,
    onSelect,
    onNavKeyDown,
    onLeave,
    isHosted,
    className,
}: Props) {
    return (
        <aside
            className={cn(
                "w-62 shrink-0 flex-col gap-5.5 overflow-y-auto border-r border-border bg-surface px-3.5 py-5.5",
                className,
            )}
        >
            <div className="px-2">
                <LibraryBackLink onNavigate={onLeave} />
            </div>
            <div className="px-2.5 font-display text-section-title font-semibold text-strong select-none">
                Settings
            </div>
            <nav aria-label="Settings">
                <ul className="flex flex-col gap-0.5" onKeyDown={onNavKeyDown}>
                    {nav.map((item) => {
                        const active = item.id === activePage;
                        return (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    data-settings-nav-item=""
                                    data-page={item.id}
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => onSelect(item.id)}
                                    className={cn(
                                        "squircle flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-left text-ui outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                        active
                                            ? "bg-accent font-semibold text-strong"
                                            : "font-medium text-foreground hover:bg-accent/60",
                                    )}
                                >
                                    <item.icon
                                        className="size-4.5 shrink-0 text-subtle"
                                        aria-hidden="true"
                                    />
                                    <StableLabel>{item.name}</StableLabel>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            <AppLinksLine isHosted={isHosted} className="mt-auto px-2.5" />
        </aside>
    );
}
