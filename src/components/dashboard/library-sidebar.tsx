"use client";

import { Search, Settings, TextAlignStart, X } from "lucide-react";
import type * as React from "react";
import { useId } from "react";
import { UserMenu } from "@/components/dashboard/user-menu";
import { LogoWordmark } from "@/components/icons/logo";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RecorderDevice } from "@/types/device";

interface LibrarySidebarProps {
    /** Total recordings in the library. The count is hidden at zero. */
    recordingCount: number;
    devices: RecorderDevice[];
    /** True while Plaud has signed the user out (connection invalidated). */
    plaudNeedsReconnect: boolean;
    query: string;
    onQueryChange: (next: string) => void;
    onEnterSelectFirst: () => void;
    searchRef: React.RefObject<HTMLInputElement | null>;
    /** Clears search and filters so the full library shows. */
    onShowLibrary: () => void;
    isAdmin: boolean;
    userEmail: string | null;
    userName: string | null;
    isHosted: boolean;
    onOpenSettings: () => void;
    /** Called on hover or focus of a Settings entry so its data can load before the click. */
    onSettingsIntent: () => void;
    onOpenShortcuts: () => void;
    className?: string;
}

/** `sidebar` is the desktop sidebar; `drawer` the phone menu, with 44px rows. */
export type LibraryNavVariant = "sidebar" | "drawer";

const navStyles = {
    sidebar: {
        item: "h-9 gap-2.5 px-2.5",
        label: "text-ui",
        count: "text-xs",
        heading: "px-2.5 text-xs",
        row: "gap-2.5 px-2.5 py-1.5",
        name: "text-ui",
        status: "text-xs",
    },
    drawer: {
        item: "h-11 gap-3 px-3",
        label: "text-row leading-5",
        count: "text-small leading-4",
        heading: "px-3 text-small leading-4",
        row: "min-h-13 gap-2 py-1.5 pr-3 pl-2",
        name: "text-row leading-5",
        status: "text-small leading-4",
    },
} as const;

/** The Library entry with its recording count, hidden at zero. */
export function LibraryNavItem({
    recordingCount,
    onClick,
    variant,
}: {
    recordingCount: number;
    onClick: () => void;
    variant: LibraryNavVariant;
}) {
    const s = navStyles[variant];
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current="page"
            className={cn(
                "squircle flex items-center rounded-[var(--radius-control)] bg-accent text-left outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                s.item,
            )}
        >
            <TextAlignStart
                className="size-4.5 shrink-0 text-foreground"
                aria-hidden="true"
            />
            <span className={cn("flex-1 font-semibold text-strong", s.label)}>
                Library
            </span>
            {recordingCount > 0 ? (
                <span
                    className={cn(
                        "text-muted-foreground tabular-nums",
                        s.count,
                    )}
                >
                    {recordingCount}
                </span>
            ) : null}
        </button>
    );
}

/**
 * The user's recorders and how their recordings arrive ("Via Plaud", or
 * "Not syncing" while Plaud has signed the user out). Renders nothing
 * without recorders.
 */
export function RecordersSection({
    devices,
    plaudNeedsReconnect,
    variant,
}: {
    devices: RecorderDevice[];
    plaudNeedsReconnect: boolean;
    variant: LibraryNavVariant;
}) {
    const headingId = useId();
    if (devices.length === 0) return null;
    const s = navStyles[variant];
    return (
        <section
            aria-labelledby={headingId}
            className="flex min-h-0 flex-col gap-0.5 select-none"
        >
            <h2
                id={headingId}
                className={cn(
                    "pb-1.5 font-medium text-muted-foreground",
                    s.heading,
                )}
            >
                Recorders
            </h2>
            <ul className="flex flex-col gap-0.5 overflow-y-auto">
                {devices.map((device) => (
                    <li
                        key={device.serialNumber}
                        className={cn("flex items-center", s.row)}
                    >
                        <span
                            className="flex h-8.5 w-6.5 shrink-0 items-center justify-center"
                            aria-hidden="true"
                        >
                            <span className="h-7 w-4 rounded-sm bg-accent" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-px">
                            <span
                                className={cn(
                                    "truncate font-medium text-foreground",
                                    s.name,
                                )}
                            >
                                {device.name || device.model}
                            </span>
                            <span
                                className={cn(
                                    "flex items-center gap-1.5 text-muted-foreground",
                                    s.status,
                                )}
                            >
                                <StatusDot
                                    size="small"
                                    tone={
                                        plaudNeedsReconnect ? "idle" : "ready"
                                    }
                                />
                                {plaudNeedsReconnect
                                    ? "Not syncing"
                                    : "Via Plaud"}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * Desktop sidebar for the dashboard: search, the Library entry, the
 * user's recorders and the account row. Follows the first-run rule:
 * with no recordings the count is hidden, and with no recorders the
 * Recorders section is left out. The phone menu drawer shows the same
 * Library entry and recorders.
 */
export function LibrarySidebar({
    recordingCount,
    devices,
    plaudNeedsReconnect,
    query,
    onQueryChange,
    onEnterSelectFirst,
    searchRef,
    onShowLibrary,
    isAdmin,
    userEmail,
    userName,
    isHosted,
    onOpenSettings,
    onSettingsIntent,
    onOpenShortcuts,
    className,
}: LibrarySidebarProps) {
    return (
        <aside
            className={cn(
                "w-62 shrink-0 flex-col justify-between border-r border-border bg-surface px-3.5 pt-5.5 pb-4",
                className,
            )}
        >
            <div className="flex min-h-0 flex-col gap-5.5">
                <div className="flex h-7 items-center px-2">
                    <LogoWordmark className="h-5 w-auto text-strong" />
                </div>

                <search className="squircle flex h-9.5 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] border border-border bg-card pr-2.5 pl-3 focus-within:ring-[3px] focus-within:ring-ring/50">
                    <Search
                        className="size-4.5 shrink-0 text-foreground"
                        aria-hidden="true"
                    />
                    <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                onEnterSelectFirst();
                            } else if (e.key === "Escape" && query) {
                                e.preventDefault();
                                onQueryChange("");
                            }
                        }}
                        placeholder="Search"
                        aria-label="Search recordings and transcripts"
                        className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query ? (
                        <button
                            type="button"
                            onClick={() => {
                                onQueryChange("");
                                searchRef.current?.focus();
                            }}
                            aria-label="Clear search"
                            className="squircle flex size-5 items-center justify-center rounded-[var(--radius-small)] text-muted-foreground hover:text-foreground"
                        >
                            <X className="size-3.5" />
                        </button>
                    ) : (
                        <kbd className="squircle rounded-[var(--radius-small)] bg-accent px-1.5 py-0.5 font-sans text-xs text-muted-foreground select-none dark:bg-row-selected">
                            /
                        </kbd>
                    )}
                </search>

                <nav aria-label="Library" className="flex flex-col gap-0.5">
                    <LibraryNavItem
                        recordingCount={recordingCount}
                        onClick={onShowLibrary}
                        variant="sidebar"
                    />
                </nav>

                <RecordersSection
                    devices={devices}
                    plaudNeedsReconnect={plaudNeedsReconnect}
                    variant="sidebar"
                />
            </div>

            <div className="flex items-center gap-1">
                <UserMenu
                    isAdmin={isAdmin}
                    isHosted={isHosted}
                    userEmail={userEmail}
                    userName={userName}
                    onOpenShortcuts={onOpenShortcuts}
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            onClick={onOpenSettings}
                            onPointerEnter={onSettingsIntent}
                            onFocus={onSettingsIntent}
                            aria-label="Settings"
                            className="text-foreground"
                        >
                            <Settings className="size-4.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Settings</TooltipContent>
                </Tooltip>
            </div>
        </aside>
    );
}
