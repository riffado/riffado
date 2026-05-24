import {
    differenceInDays,
    format,
    formatDistanceToNow,
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

/** Recording-list group label: Today / Yesterday / This week / month / Month YYYY. */
/**
 * Discriminated descriptor for the recording-list group header that a
 * given date belongs to. Callers switch on `kind` and translate
 * accordingly; `text` for `month` / `monthYear` is the date-fns-
 * formatted month/year string passed through unchanged because the
 * date-math concern shouldn't reach into the i18n layer.
 */
export type DateGroup =
    | { kind: "today" }
    | { kind: "yesterday" }
    | { kind: "thisWeek" }
    | { kind: "earlierThisMonth" }
    | { kind: "month"; text: string }
    | { kind: "monthYear"; text: string };

export function dateGroup(date: Date | string): DateGroup {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isToday(d)) return { kind: "today" };
    if (isYesterday(d)) return { kind: "yesterday" };
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return { kind: "thisWeek" };
    if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
    ) {
        return { kind: "earlierThisMonth" };
    }
    return isThisYear(d)
        ? { kind: "month", text: format(d, "MMMM") }
        : { kind: "monthYear", text: format(d, "MMMM yyyy") };
}

/**
 * Legacy English label kept for callers that haven't migrated to the
 * discriminator. New code should use `dateGroup()` and translate via
 * `useTranslations`.
 */
export function dateGroupLabel(date: Date | string): string {
    const g = dateGroup(date);
    switch (g.kind) {
        case "today":
            return "Today";
        case "yesterday":
            return "Yesterday";
        case "thisWeek":
            return "This week";
        case "earlierThisMonth":
            return "Earlier this month";
        default:
            return g.text;
    }
}
