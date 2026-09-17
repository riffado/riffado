import {
    differenceInDays,
    format,
    formatDistanceToNow,
    isSameDay,
    isThisYear,
    isToday,
    isYesterday,
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
