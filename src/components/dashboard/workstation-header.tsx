"use client";

import { Command, Upload } from "lucide-react";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
    isAdmin: boolean;
    isHosted: boolean;
    userEmail: string | null;
    /** Display name for the account menu, or null when the account has none. */
    userName: string | null;
    lastSyncTime: Date | null;
    nextSyncTime: Date | null;
    isAutoSyncing: boolean;
    lastSyncResult: {
        success: boolean;
        newRecordings?: number;
        error?: string;
    } | null;
    onSync: () => void;
    /** False hides the sync button (no Plaud connection to sync from). */
    showSync: boolean;
    isUploading: boolean;
    isProcessing: boolean;
    onTriggerUpload: () => void;
    onOpenPalette: () => void;
    onOpenSettings: () => void;
    /** Called on hover or focus of the Settings entry so its data can load before the click. */
    onSettingsIntent: () => void;
    onOpenShortcuts: () => void;
    /** True while something covers the header (the phone reader), so it leaves the tab order and the accessibility tree. */
    inert?: boolean;
    className?: string;
}

/**
 * Sticky page header for the dashboard workstation below `lg`. On `lg`+
 * the sidebar and the list pane header take over its actions.
 *
 * Title left, actions right, always one row. On mobile the buttons
 * collapse to icon-only (per-button `sm:` overrides) so the whole bar
 * fits in ~360px. `min-w-0` on the title block lets it truncate before
 * pushing buttons off-screen.
 *
 * Action order is intentional: search palette (most general), sync
 * (most frequent), upload (alternate ingest path), user menu (escape
 * hatch to settings + identity). The sync button is status-aware --
 * its label includes "Synced 2m ago" / "Retry sync" / "Syncing..."
 * so a separate status block isn't needed.
 */
export function WorkstationHeader({
    isAdmin,
    isHosted,
    userEmail,
    userName,
    lastSyncTime,
    nextSyncTime,
    isAutoSyncing,
    lastSyncResult,
    onSync,
    showSync,
    isUploading,
    isProcessing,
    onTriggerUpload,
    onOpenPalette,
    onOpenSettings,
    onSettingsIntent,
    onOpenShortcuts,
    inert = false,
    className,
}: Props) {
    return (
        <div
            inert={inert}
            className={cn(
                "sticky top-0 z-30 -mx-4 mb-6 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70",
                className,
            )}
        >
            <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="truncate text-xl font-semibold leading-tight select-none sm:text-2xl md:text-3xl">
                    Library
                </h1>
                {/*
                  Recording count lives in the list pane's own meta row
                  ("N of N recordings") -- showing it again in the page
                  header is duplicative on every breakpoint, so the
                  count is gone here.
                */}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={onOpenPalette}
                            variant="outline"
                            size="sm"
                            className="hidden h-11 md:inline-flex"
                            aria-label="Open command palette"
                        >
                            <Command className="mr-2 size-4" />
                            <span>Search</span>
                            <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
                                ⌘K
                            </kbd>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Search recordings, transcripts, and actions
                    </TooltipContent>
                </Tooltip>
                {showSync ? (
                    <SyncButton
                        lastSyncTime={lastSyncTime}
                        nextSyncTime={nextSyncTime}
                        isAutoSyncing={isAutoSyncing}
                        lastSyncResult={lastSyncResult}
                        onSync={onSync}
                        className="h-11 min-w-11"
                    />
                ) : null}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={onTriggerUpload}
                            disabled={isProcessing}
                            variant="outline"
                            size="sm"
                            className="h-11 min-w-11"
                            aria-label={
                                isUploading ? "Uploading audio" : "Upload audio"
                            }
                        >
                            <Upload className="size-4 sm:mr-2" />
                            <span className="hidden sm:inline">
                                {isUploading ? "Uploading…" : "Upload Audio"}
                            </span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Upload an audio file from your computer
                    </TooltipContent>
                </Tooltip>
                <UserMenu
                    isAdmin={isAdmin}
                    isHosted={isHosted}
                    userEmail={userEmail}
                    userName={userName}
                    onOpenSettings={onOpenSettings}
                    onSettingsIntent={onSettingsIntent}
                    onOpenShortcuts={onOpenShortcuts}
                />
            </div>
        </div>
    );
}
