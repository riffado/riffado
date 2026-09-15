import {
    differenceInDays,
    format,
    formatDistanceToNow,
    isThisYear,
    isToday,
    isYesterday,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { uiText } from "@/lib/i18n";
import type { DateTimeFormat } from "@/types/common";

export type { DateTimeFormat };

export function formatDateTime(
    date: Date | string,
    formatType: DateTimeFormat = "relative",
): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    switch (formatType) {
        case "relative":
            return formatDistanceToNow(dateObj, {
                addSuffix: true,
                locale: zhCN,
            });
        case "absolute":
            return format(dateObj, "yyyy年M月d日 HH:mm", { locale: zhCN });
        case "iso":
            return dateObj.toISOString();
        default:
            return formatDistanceToNow(dateObj, {
                addSuffix: true,
                locale: zhCN,
            });
    }
}

/** Recording-list group label: Today / Yesterday / This week / month / Month YYYY. */
export function dateGroupLabel(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isToday(d)) return uiText("Today");
    if (isYesterday(d)) return uiText("Yesterday");
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return uiText("This week");
    if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
    ) {
        return uiText("Earlier this month");
    }
    return isThisYear(d)
        ? format(d, "M月", { locale: zhCN })
        : format(d, "yyyy年M月", { locale: zhCN });
}
