"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";

/**
 * Compact relative-time descriptor for the sync button label.
 *
 * Returns a discriminated union instead of an English string so the
 * renderer can pick the right ICU-plural translation. The previous
 * shape concatenated "Synchronisiert vor " + "2m ago" → denglish.
 *
 * The bucketing is intentionally terse: "just now" / "Xm ago" /
 * "Xh ago" / "Xd ago" / "Xw ago" — `date-fns` defaults ("about 1 hour")
 * blow the button width past what fits in the header.
 */
type AgoBucket =
    | { kind: "invalid" }
    | { kind: "justNow" }
    | { kind: "minutes"; n: number }
    | { kind: "hours"; n: number }
    | { kind: "days"; n: number }
    | { kind: "weeks"; n: number };

function compactAgo(from: Date): AgoBucket {
    const ts = from.getTime();
    if (!Number.isFinite(ts)) return { kind: "invalid" };
    const diffMs = Date.now() - ts;
    // Clock skew / future dates collapse to "just now" rather than a
    // negative duration the i18n templates aren't set up to render.
    if (diffMs < 0) return { kind: "justNow" };
    const sec = Math.floor(diffMs / 1000);
    // Everything under a minute is "just now" — otherwise the 45–59s
    // window would render "0 min ago" (floor(sec/60)).
    if (sec < 60) return { kind: "justNow" };
    const min = Math.floor(sec / 60);
    if (min < 60) return { kind: "minutes", n: min };
    const hr = Math.floor(min / 60);
    if (hr < 24) return { kind: "hours", n: hr };
    const day = Math.floor(hr / 24);
    if (day < 7) return { kind: "days", n: day };
    return { kind: "weeks", n: Math.floor(day / 7) };
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
    const locale = useLocale();
    const failed = !isAutoSyncing && lastSyncResult?.success === false;

    const label = (() => {
        if (isAutoSyncing) return t("syncing");
        if (failed) return t("retrySync");
        if (!lastSyncTime) return tDash("syncDevice");
        const ago = compactAgo(lastSyncTime);
        switch (ago.kind) {
            case "invalid":
            case "justNow":
                return t("syncedJustNow");
            case "minutes":
                return t("syncedMinutesAgo", { count: ago.n });
            case "hours":
                return t("syncedHoursAgo", { count: ago.n });
            case "days":
                return t("syncedDaysAgo", { count: ago.n });
            case "weeks":
                return t("syncedWeeksAgo", { count: ago.n });
        }
    })();

    // Tooltip: secondary context for users who hover. Packs the old
    // stacked layout's secondary lines (next sync ETA, last-error
    // message) into a single string so a tooltip primitive isn't
    // needed just for this.
    const title = (() => {
        const parts: string[] = [];
        if (failed && lastSyncResult?.error) {
            parts.push(lastSyncResult.error);
        }
        if (!isAutoSyncing && nextSyncTime) {
            try {
                const diff = nextSyncTime.getTime() - Date.now();
                if (diff < 60000) {
                    parts.push(t("nextAutoSyncSoon"));
                } else {
                    parts.push(
                        t("nextAutoSync", {
                            time: formatDateTime(
                                nextSyncTime,
                                "relative",
                                locale,
                            ),
                        }),
                    );
                }
            } catch {
                // Ignore - we just won't include the next-sync line.
            }
        }
        parts.push(
            isAutoSyncing ? t("syncInProgress") : t("clickToSyncNow"),
        );
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
