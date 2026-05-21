/** Format seconds as `M:SS` / `H:MM:SS`. Non-finite/negative -> `"0:00"`. */
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

/** Format `current` matching `reference`'s segment structure for a stable-width clock. */
export function formatTimeLike(current: number, reference: number): string {
    if (!Number.isFinite(reference) || reference <= 0) {
        return formatDuration(current);
    }
    const safeCurrent =
        Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
    const refTotal = Math.floor(reference);
    const pad2 = (n: number) => n.toString().padStart(2, "0");

    const refHours = Math.floor(refTotal / 3600);
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

export function formatDurationMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    return formatDuration(ms / 1000);
}

/** Compact duration: `X min` under an hour, `X.Y h`/`Xh` above. */
export function formatHoursCompact(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0 min";
    const minutes = ms / 60_000;
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 10) return `${hours.toFixed(1)} h`;
    return `${Math.round(hours)} h`;
}
