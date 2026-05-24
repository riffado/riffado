"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Compact relative-time string for the sync button label.
 *
 * `date-fns` defaults ("less than a minute", "about 1 hour") balloon
 * the button width past what we want in the header. This formatter
 * is intentionally terse: "just now" / "2m ago" / "3h ago" / "5d
 * ago". Loses some precision in exchange for a button that doesn't
 * dominate the toolbar.
 */
function compactAgo(from: Date): string {
    // Guard against `new Date(invalid)` reaching us — `getTime()` would
    // return NaN and every downstream branch would render "NaN m ago".
    const ts = from.getTime();
    if (!Number.isFinite(ts)) return "";
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return "just now";
    const sec = Math.floor(diffMs / 1000);
    // Everything under a minute reads as "just now" — otherwise the
    // 45–59 s window renders "0m ago" because `min = floor(sec/60)`.
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.floor(day / 7);
    return `${wk}w ago`;
}

/**
 * Status-aware sync action.
 *
 * Replaces what used to be a stacked status block ("Synced 2m ago / Next
 * sync in 3m") sitting next to a separate "Sync device" button. One
 * affordance is friendlier: the button itself communicates state, and
 * clicking it is the only action available anyway. The tooltip carries
 * the secondary detail (next auto-sync ETA, error message) for users who
 * want it.
 *
 * State map:
 *   syncing     -> icon spins, label "Syncing...", disabled
 *   failed      -> AlertCircle, label "Retry sync", destructive tone, clickable
 *   has last    -> RefreshCw, label "Synced <relative>", normal tone
 *   never       -> RefreshCw, label "Sync device", normal tone
 *
 * The label collapses to icon-only below `sm` (same breakpoint the
 * old Sync button used) so the header still fits on a phone.
 */
interface SyncButtonProps {
    lastSyncTime: Date | null;
    nextSyncTime: Date | null;
    isAutoSyncing: boolean;
    lastSyncResult: {
        success: boolean;
        newRecordings?: number;
        error?: string;
    } | null;
    onSync: () => void;
    className?: string;
}

export function SyncButton({
    lastSyncTime,
    nextSyncTime,
    isAutoSyncing,
    lastSyncResult,
    onSync,
    className,
}: SyncButtonProps) {
    const t = useTranslations("syncButton");
    const tDash = useTranslations("dashboard");
    const failed = !isAutoSyncing && lastSyncResult?.success === false;

    const label = (() => {
        if (isAutoSyncing) return t("syncing");
        if (failed) return t("retrySync");
        if (lastSyncTime) {
            try {
                const ago = compactAgo(lastSyncTime);
                return ago === "just now"
                    ? t("syncedJustNow")
                    : t("syncedAgo", { time: ago });
            } catch {
                return t("syncedJustNow");
            }
        }
        return tDash("syncDevice");
    })();

    // Tooltip: secondary context for users who hover. We pack what the
    // old stacked layout showed below the primary line (next sync ETA,
    // last-error message) into a single `title=` string so we don't
    // need a tooltip primitive just for this.
    const title = (() => {
        const parts: string[] = [];
        if (failed && lastSyncResult?.error) {
            parts.push(lastSyncResult.error);
        }
        if (!isAutoSyncing && nextSyncTime) {
            try {
                const diff = nextSyncTime.getTime() - Date.now();
                if (diff < 60000) {
                    parts.push("Next auto-sync soon");
                } else {
                    parts.push(
                        `Next auto-sync ${formatDistanceToNow(nextSyncTime, {
                            addSuffix: true,
                        })}`,
                    );
                }
            } catch {
                // Ignore - we just won't include the next-sync line.
            }
        }
        parts.push(isAutoSyncing ? "Sync in progress" : "Click to sync now");
        return parts.join(" \u00b7 ");
    })();

    const ariaLabel = isAutoSyncing
        ? t("syncing")
        : failed
          ? t("retrySync")
          : tDash("syncDevice");

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    onClick={onSync}
                    disabled={isAutoSyncing}
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-9",
                        // Subtle destructive accent on failure: keeps
                        // the outline shape (so the header doesn't get
                        // a loud filled red button) but tints the
                        // border + text.
                        failed &&
                            "border-destructive/40 text-destructive hover:bg-destructive/10",
                        className,
                    )}
                    aria-label={ariaLabel}
                >
                    {failed ? (
                        <AlertCircle
                            className="size-4 sm:mr-2"
                            aria-hidden="true"
                        />
                    ) : (
                        <RefreshCw
                            className={cn(
                                "size-4 sm:mr-2",
                                isAutoSyncing && "animate-spin",
                            )}
                            aria-hidden="true"
                        />
                    )}
                    <span className="hidden sm:inline">{label}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{title}</TooltipContent>
        </Tooltip>
    );
}
