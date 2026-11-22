import {
    differenceInDays,
    format,
    formatDistanceToNow,
    isSameDay,
    isThisYear,
    isToday,
    isYesterday,
    subDays,
} from "date-fns";
import type { DateTimeFormat } from "@/types/common";

export type { DateTimeFormat };

export function formatDateTime(
    date: Date | string,
    formatType: DateTimeFormat = "relative",
): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    switch (formatType) {
        case "relative":
            return formatDistanceToNow(dateObj, { addSuffix: true });
        case "absolute":
            return format(dateObj, "MMM d, yyyy h:mm a");
        case "iso":
            return dateObj.toISOString();
        default:
            return formatDistanceToNow(dateObj, { addSuffix: true });
    }
}

/** Absolute local date and start–end time for a recording. */
export function formatRecordingDateTimeRange(
    start: Date | string,
    durationMs: number,
): string {
    const startDate = typeof start === "string" ? new Date(start) : start;
    const endDate = new Date(startDate.getTime() + durationMs);

    if (isSameDay(startDate, endDate)) {
        return `${format(startDate, "MMM d, yyyy · h:mm a")}–${format(endDate, "h:mm a")}`;
    }

    return `${format(startDate, "MMM d, yyyy · h:mm a")}–${format(endDate, "MMM d, yyyy · h:mm a")}`;
}

/** Recording-list group label: Today / Yesterday / This week / month / Month YYYY. */
export function dateGroupLabel(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return "This week";
    if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
    ) {
        return "Earlier this month";
    }
    return isThisYear(d) ? format(d, "MMMM") : format(d, "MMMM yyyy");
}

/** How long ago a sync happened, for sync status copy: "4 min ago". */
export function formatSyncedAgo(date: Date, now: number): string {
    const ts = date.getTime();
    if (!Number.isFinite(ts)) return "";
    const minutes = Math.floor((now - ts) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * Time detail for a recording row's metadata line. Rows sit under a day
 * group, so recent rows show the time of day, the rest of the week the
 * weekday, and older rows the date.
 */
export function formatRowTime(date: Date | string, now: Date): string {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isSameDay(d, now) || isSameDay(d, subDays(now, 1))) {
        return format(d, "HH:mm");
    }
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return format(d, "EEE");
    return isThisYear(d) ? format(d, "MMM d") : format(d, "MMM d, yyyy");
}
