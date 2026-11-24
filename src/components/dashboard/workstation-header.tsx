"use client";

import { Menu, RefreshCw, Upload } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { PhoneDrawer } from "@/components/dashboard/phone-drawer";
import { Button } from "@/components/ui/button";
import { useSettledSpin } from "@/hooks/use-settled-spin";
import { formatSyncedAgo } from "@/lib/format-date";
import { cn } from "@/lib/utils";

type DrawerProps = Omit<
    ComponentProps<typeof PhoneDrawer>,
    "open" | "onOpenChange" | "returnFocusTo" | "trigger"
>;

interface Props {
    /** False hides the sync status and Sync now (no Plaud connection). */
    showSync: boolean;
    /** True while Plaud has signed the user out; Sync now can't help then. */
    needsReconnect: boolean;
    lastSyncTime: Date | null;
    /** Last sync the server recorded as successful, if known. */
    lastSuccessfulSyncTime: Date | null;
    isAutoSyncing: boolean;
    lastSyncResult: { success: boolean } | null;
    onSync: () => void;
    isUploading: boolean;
    isProcessing: boolean;
    onTriggerUpload: () => void;
    /** What the menu drawer shows and does. */
    drawer: DrawerProps;
    /** True while something covers the header (the phone reader), so it leaves the tab order and the accessibility tree. */
    inert?: boolean;
    className?: string;
}

function useMinuteClock(): number | null {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

/** "Synced 4 min ago", "Syncing…", "Sync failed", or null when there's nothing to say. */
export function syncStatusLabel({
    isAutoSyncing,
    failed,
    needsReconnect,
    syncTime,
    now,
}: {
    isAutoSyncing: boolean;
    failed: boolean;
    needsReconnect: boolean;
    syncTime: Date | null;
    now: number | null;
}): string | null {
    if (isAutoSyncing) return "Syncing…";
    if (failed && !needsReconnect) return "Sync failed";
    if (!syncTime || now === null) return null;
    const ago = formatSyncedAgo(syncTime, now);
    if (!ago) return null;
    return needsReconnect ? `Last synced ${ago}` : `Synced ${ago}`;
}

const iconButtonClass =
    "squircle size-11 rounded-[var(--radius-control)] text-foreground";

/**
 * The library's top bar below `lg`: menu, "Library" with the sync status
 * under it, Sync now and Upload. Account items live in the menu drawer.
 * Without a Plaud connection there is no status and no Sync now.
 */
export function WorkstationHeader({
    showSync,
    needsReconnect,
    lastSyncTime,
    lastSuccessfulSyncTime,
    isAutoSyncing,
    lastSyncResult,
    onSync,
    isUploading,
    isProcessing,
    onTriggerUpload,
    drawer,
    inert = false,
    className,
}: Props) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const now = useMinuteClock();
    const spin = useSettledSpin(isAutoSyncing);
    const failed = !isAutoSyncing && lastSyncResult?.success === false;
    const status = showSync
        ? syncStatusLabel({
              isAutoSyncing,
              failed,
              needsReconnect,
              syncTime: needsReconnect
                  ? lastSuccessfulSyncTime
                  : (lastSyncTime ?? lastSuccessfulSyncTime),
              now,
          })
        : null;

    return (
        <header
            inert={inert}
            className={cn(
                "sticky top-0 z-30 -mx-4 flex items-center bg-background pt-[env(safe-area-inset-top)] pr-2 pl-1.5",
                className,
            )}
        >
            <div className="flex h-15 min-w-0 flex-1 items-center">
                <PhoneDrawer
                    {...drawer}
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    returnFocusTo={menuButtonRef}
                    trigger={
                        <Button
                            ref={menuButtonRef}
                            variant="ghost"
                            size="icon"
                            className={iconButtonClass}
                            aria-label="Open menu"
                        >
                            <Menu className="size-5.5" aria-hidden="true" />
                        </Button>
                    }
                />
                <div className="flex min-w-0 flex-1 flex-col gap-px pl-1.5">
                    <h1 className="truncate font-display text-section-title leading-6.5 font-semibold text-strong select-none">
                        Library
                    </h1>
                    {status ? (
                        <p
                            className="truncate text-xs text-muted-foreground tabular-nums select-none"
                            aria-live="polite"
                        >
                            {status}
                        </p>
                    ) : null}
                </div>
                {showSync && !needsReconnect ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(iconButtonClass, "disabled:opacity-100")}
                        onClick={onSync}
                        disabled={isAutoSyncing}
                        aria-label={failed ? "Retry sync" : "Sync now"}
                    >
                        <RefreshCw
                            ref={spin.ref}
                            className={cn(
                                "size-5",
                                spin.spinning &&
                                    "animate-spin motion-reduce:animate-pulse",
                            )}
                            aria-hidden="true"
                        />
                    </Button>
                ) : null}
                <Button
                    variant="ghost"
                    size="icon"
                    className={iconButtonClass}
                    onClick={onTriggerUpload}
                    disabled={isProcessing}
                    aria-label={
                        isUploading ? "Uploading audio" : "Upload audio"
                    }
                >
                    <Upload className="size-5" aria-hidden="true" />
                </Button>
            </div>
        </header>
    );
}
