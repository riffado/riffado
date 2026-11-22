"use client";

import { Search, Settings, TextAlignStart, X } from "lucide-react";
import type * as React from "react";
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
    initialTheme: "light" | "dark" | "system";
    onOpenSettings: () => void;
    /** Called on hover or focus of a Settings entry so its data can load before the click. */
    onSettingsIntent: () => void;
    onOpenShortcuts: () => void;
    className?: string;
}

/**
 * Desktop sidebar for the dashboard: search, the Library entry, the
 * user's recorders and the account row. Follows the first-run rule:
 * with no recordings the count is hidden, and with no recorders the
 * Recorders section is left out.
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
    initialTheme,
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
                        <kbd className="squircle rounded-[var(--radius-small)] bg-accent px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                            /
                        </kbd>
                    )}
                </search>

                <nav aria-label="Library" className="flex flex-col gap-0.5">
                    <button
                        type="button"
                        onClick={onShowLibrary}
                        aria-current="page"
                        className="squircle flex h-9 items-center gap-2.5 rounded-[var(--radius-control)] bg-accent px-2.5 text-left outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        <TextAlignStart
                            className="size-4.5 shrink-0 text-foreground"
                            aria-hidden="true"
                        />
                        <span className="flex-1 text-ui font-semibold text-strong">
                            Library
                        </span>
                        {recordingCount > 0 ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {recordingCount}
                            </span>
                        ) : null}
                    </button>
                </nav>

                {devices.length > 0 ? (
                    <section
                        aria-labelledby="sidebar-recorders"
                        className="flex min-h-0 flex-col gap-0.5"
                    >
                        <h2
                            id="sidebar-recorders"
                            className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground"
                        >
                            Recorders
                        </h2>
                        <ul className="flex flex-col gap-0.5 overflow-y-auto">
                            {devices.map((device) => (
                                <li
                                    key={device.serialNumber}
                                    className="flex items-center gap-2.5 px-2.5 py-1.5"
                                >
                                    <span
                                        className="flex h-8.5 w-6.5 shrink-0 items-center justify-center"
                                        aria-hidden="true"
                                    >
                                        <span className="h-7 w-4 rounded-sm bg-accent" />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                                        <span className="truncate text-ui font-medium text-foreground">
                                            {device.name || device.model}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <StatusDot
                                                size="small"
                                                tone={
                                                    plaudNeedsReconnect
                                                        ? "idle"
                                                        : "ready"
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
                ) : null}
            </div>

            <div className="flex items-center gap-1">
                <UserMenu
                    trigger="sidebar"
                    isAdmin={isAdmin}
                    initialTheme={initialTheme}
                    userEmail={userEmail}
                    userName={userName}
                    onOpenSettings={onOpenSettings}
                    onSettingsIntent={onSettingsIntent}
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
