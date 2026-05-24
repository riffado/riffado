"use client";

import { Command, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
    isAdmin: boolean;
    userEmail: string | null;
    initialTheme: "light" | "dark" | "system";
    lastSyncTime: Date | null;
    nextSyncTime: Date | null;
    isAutoSyncing: boolean;
    lastSyncResult: {
        success: boolean;
        newRecordings?: number;
        error?: string;
    } | null;
    onSync: () => void;
    isUploading: boolean;
    isProcessing: boolean;
    uploadInputRef: React.RefObject<HTMLInputElement | null>;
    onTriggerUpload: () => void;
    onUploadInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onOpenPalette: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
}

/**
 * Sticky page header for the dashboard workstation.
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
    userEmail,
    initialTheme,
    lastSyncTime,
    nextSyncTime,
    isAutoSyncing,
    lastSyncResult,
    onSync,
    isUploading,
    isProcessing,
    uploadInputRef,
    onTriggerUpload,
    onUploadInputChange,
    onOpenPalette,
    onOpenSettings,
    onOpenShortcuts,
}: Props) {
    const t = useTranslations("dashboard");
    const tCommon = useTranslations("common");
    return (
        <div className="sticky top-0 z-30 -mx-4 mb-6 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="truncate text-xl font-semibold leading-tight sm:text-2xl md:text-3xl">
                    {t("title")}
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
                            className="hidden h-9 md:inline-flex"
                            aria-label="Open command palette"
                        >
                            <Command className="mr-2 size-4" />
                            <span>{tCommon("search")}</span>
                            <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
                                ⌘K
                            </kbd>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Search recordings, transcripts, and actions
                    </TooltipContent>
                </Tooltip>
                <SyncButton
                    lastSyncTime={lastSyncTime}
                    nextSyncTime={nextSyncTime}
                    isAutoSyncing={isAutoSyncing}
                    lastSyncResult={lastSyncResult}
                    onSync={onSync}
                />
                <input
                    ref={uploadInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={onUploadInputChange}
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={onTriggerUpload}
                            disabled={isProcessing}
                            variant="outline"
                            size="sm"
                            className="h-9"
                            aria-label={
                                isUploading ? "Uploading audio" : "Upload audio"
                            }
                        >
                            <Upload className="size-4 sm:mr-2" />
                            <span className="hidden sm:inline">
                                {isUploading
                                    ? tCommon("loading")
                                    : t("uploadAudio")}
                            </span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Upload an audio file from your computer
                    </TooltipContent>
                </Tooltip>
                <UserMenu
                    isAdmin={isAdmin}
                    initialTheme={initialTheme}
                    userEmail={userEmail}
                    onOpenSettings={onOpenSettings}
                    onOpenShortcuts={onOpenShortcuts}
                />
            </div>
        </div>
    );
}
