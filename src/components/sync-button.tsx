"use client";

import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { uiText } from "@/lib/i18n";
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
    if (diffMs < 0) return uiText("just now");
    const sec = Math.floor(diffMs / 1000);
    // Everything under a minute reads as "just now" — otherwise the
    // 45–59 s window renders "0m ago" because `min = floor(sec/60)`.
    if (sec < 60) return uiText("just now");
    const min = Math.floor(sec / 60);
    if (min < 60) return uiText("{count} minutes ago", { count: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return uiText("{count} hours ago", { count: hr });
    const day = Math.floor(hr / 24);
    if (day < 7) return uiText("{count} days ago", { count: day });
    const wk = Math.floor(day / 7);
    return uiText("{count} weeks ago", { count: wk });
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
    const failed = !isAutoSyncing && lastSyncResult?.success === false;

    const label = (() => {
        if (isAutoSyncing) return uiText("Syncing...");
        if (failed) return uiText("Retry sync");
        if (lastSyncTime) {
            try {
                return uiText("Synced {time}", {
                    time: compactAgo(lastSyncTime),
                });
            } catch {
                return uiText("Synced recently");
            }
        }
        return uiText("Sync device");
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
                    parts.push(uiText("Next auto-sync soon"));
                } else {
                    parts.push(
                        uiText("Next auto-sync {time}", {
                            time: formatDistanceToNow(nextSyncTime, {
                                addSuffix: true,
                                locale: zhCN,
                            }),
                        }),
                    );
                }
            } catch {
                // Ignore - we just won't include the next-sync line.
            }
        }
        parts.push(
            isAutoSyncing
                ? uiText("Sync in progress")
                : uiText("Click to sync now"),
        );
        return parts.join(" \u00b7 ");
    })();

    const ariaLabel = isAutoSyncing
        ? uiText("Syncing device")
        : failed
          ? uiText("Retry sync")
          : uiText("Sync device");

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
