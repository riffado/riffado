"use client";

import { ChevronRight } from "lucide-react";
import type * as React from "react";
import type { NavItem } from "@/components/settings-nav-config";
import { LibraryBackLink } from "@/components/settings-nav-sidebar";
import type { SettingsPage } from "@/types/settings";

interface Props {
    nav: NavItem[];
    onSelect: (page: SettingsPage) => void;
    onNavKeyDown: (e: React.KeyboardEvent) => void;
    onLeave?: () => void;
}

/**
 * Phone and tablet layout (below lg): Settings is a list screen; tapping
 * an item pushes into that page, which shows a back control to return
 * here (see `SettingsPageContent`).
 */
export function SettingsNavMobile({
    nav,
    onSelect,
    onNavKeyDown,
    onLeave,
}: Props) {
    return (
        <div className="flex flex-col gap-5.5 px-4 pt-5.5 pb-10">
            <LibraryBackLink onNavigate={onLeave} />
            <h1 className="px-0.5 font-display text-plan-title font-semibold text-strong">
                Settings
            </h1>
            <nav aria-label="Settings">
                <ul
                    className="flex flex-col divide-y divide-hairline border-y border-hairline"
                    onKeyDown={onNavKeyDown}
                >
                    {nav.map((item) => (
                        <li key={item.id}>
                            <button
                                type="button"
                                data-settings-nav-item=""
                                data-page={item.id}
                                onClick={() => onSelect(item.id)}
                                className="flex min-h-13 w-full items-center gap-3.5 py-2 text-left outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/60"
                            >
                                <span
                                    aria-hidden="true"
                                    className="squircle flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-inner)] bg-surface text-foreground"
                                >
                                    <item.icon className="size-4.5" />
                                </span>
                                <span className="flex-1 text-row font-medium text-strong">
                                    {item.name}
                                </span>
                                <ChevronRight
                                    className="size-4.5 shrink-0 text-subtle"
                                    aria-hidden="true"
                                />
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    );
}
