/**
 * Strict `YYYY-MM-DD` calendar validation. `new Date("YYYY-MM-DDT...")`
 * silently normalizes out-of-range days (e.g. "2026-02-30" becomes
 * 2026-03-02) instead of throwing, so a typo'd date-only env var or CLI
 * flag can shift billing/grace/founding-window cutoffs by a few days
 * without any error. This rejects that: parses the components, builds
 * the UTC date, and confirms the round-trip matches exactly.
 */
export function isValidCalendarDateString(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, yearStr, monthStr, dayStr] = match;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}
