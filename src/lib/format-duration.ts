/**
 * Format a duration in seconds for display in the player, list, and
 * tooltips. Adapts the precision to the length so we don't pad short
 * recordings with leading zeros, but switch to H:MM:SS the moment we
 * cross the hour boundary.
 *
 *   < 1 hour  -> "M:SS"   (e.g. "0:42", "5:23")
 *   >= 1 hour -> "H:MM:SS" (e.g. "1:05:23", "12:00:00")
 *
 * Non-finite or negative inputs collapse to "0:00" so we never render
 * "NaN:NaN" while metadata is loading.
 */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad2 = (n: number) => n.toString().padStart(2, "0");
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
}

/**
 * Format `current` using the same segment structure as `reference`,
 * so a clock label like `currentTime / duration` keeps a stable width
 * for the whole playback.
 *
 * - reference >= 1h        -> `H:MM:SS`, hours zero-padded to match
 *                             the digit count of reference's hours
 *                             (e.g. ref `1:12:38` -> `0:10:13`,
 *                              ref `12:00:00` -> `00:05:23`).
 * - reference >= 10 min    -> `MM:SS` (zero-pad minutes to 2).
 * - reference < 10 min     -> existing `M:SS` behavior.
 * - reference not finite / -> fall back to plain `formatDuration` so we
 *   <= 0                      don't render padded zeros while audio
 *                             metadata is still loading.
 *
 * `current` is always clamped via the same finite/negative guard as
 * `formatDuration` and is never allowed to exceed the structural width
 * implied by `reference` (callers may pass `current > reference` while
 * duration metadata catches up; in that case we just widen as needed).
 */
export function formatTimeLike(current: number, reference: number): string {
    if (!Number.isFinite(reference) || reference <= 0) {
        return formatDuration(current);
    }
    const safeCurrent =
        Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
    const refTotal = Math.floor(reference);
    const pad2 = (n: number) => n.toString().padStart(2, "0");

    const refHours = Math.floor(refTotal / 3600);
    // Allow current to overflow reference's structure rather than
    // truncate — it's a display, not a clamp.
    const effHours = Math.max(refHours, Math.floor(safeCurrent / 3600));

    if (effHours > 0) {
        const h = Math.floor(safeCurrent / 3600);
        const m = Math.floor((safeCurrent % 3600) / 60);
        const s = safeCurrent % 60;
        const hourWidth = String(effHours).length;
        return `${h.toString().padStart(hourWidth, "0")}:${pad2(m)}:${pad2(s)}`;
    }

    const m = Math.floor(safeCurrent / 60);
    const s = safeCurrent % 60;
    if (refTotal >= 600) {
        return `${pad2(m)}:${pad2(s)}`;
    }
    return `${m}:${pad2(s)}`;
}

/** Convenience wrapper for callers that hold a milliseconds value. */
export function formatDurationMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    return formatDuration(ms / 1000);
}

/**
 * Compact duration for summary stats — "X min" under an hour,
 * "X.Y h" once we cross the hour mark. Used in places that want a
 * single human number rather than a M:SS / H:MM:SS clock display
 * (e.g. "38 min total across your recordings").
 */
export function formatHoursCompact(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0 min";
    const minutes = ms / 60_000;
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    // 1 decimal under 10h, integer above — keeps the number short.
    if (hours < 10) return `${hours.toFixed(1)} h`;
    return `${Math.round(hours)} h`;
}
