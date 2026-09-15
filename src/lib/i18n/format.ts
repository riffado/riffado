import { formatHoursCompact } from "@/lib/format-duration";
import { uiText } from "@/lib/i18n";

/** Localize the compact duration label without changing its rounding behavior. */
export function formatUiHoursCompact(ms: number): string {
    const [count, unit] = formatHoursCompact(ms).split(" ");
    return uiText(unit === "min" ? "{count} min" : "{count} h", { count });
}
