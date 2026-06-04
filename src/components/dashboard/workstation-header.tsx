"use client";

import { Command, Upload } from "lucide-react";
import Link from "next/link";
import { LogoWordmark } from "@/components/icons/logo";
import { SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/dashboard/user-menu";

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
    return (
        <div className="sticky top-0 z-30 -mx-4 mb-8 flex items-center gap-4 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
            {/* Logo */}
            <Link href="/dashboard" aria-label="Mesynx AI" className="shrink-0 opacity-90 hover:opacity-100 transition-opacity">
                <LogoWordmark className="h-7 w-auto text-foreground" />
            </Link>

            {/* Divider */}
            <div className="h-5 w-px bg-border/60 shrink-0 hidden sm:block" aria-hidden />

            {/* Page title */}
            <h1 className="hidden sm:block truncate text-sm font-medium text-muted-foreground select-none">
                Recordings
            </h1>

            {/* Actions */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={onOpenPalette}
                            variant="ghost"
                            size="sm"
                            className="hidden h-8 gap-2 text-muted-foreground hover:text-foreground md:inline-flex"
                            aria-label="Open command palette"
                        >
                            <Command className="size-3.5" />
                            <span className="text-xs">Search</span>
                            <kbd className="hidden rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 lg:inline">
                                ⌘K
                            </kbd>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Search recordings, transcripts and actions
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
                            className="h-8 gap-2 text-xs"
                            aria-label={isUploading ? "Uploading audio" : "Upload audio"}
                        >
                            <Upload className="size-3.5" />
                            <span className="hidden sm:inline">
                                {isUploading ? "Uploading…" : "Upload"}
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
