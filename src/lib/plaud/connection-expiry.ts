/** How long before the Plaud sign-in ends the dashboard starts warning. */
export const PLAUD_SESSION_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Which Plaud connection banner the dashboard shows: `reconnect` once Plaud
 * rejected the stored sign-in or it has already ended, `ending-soon` when it
 * ends within `PLAUD_SESSION_WARNING_WINDOW_MS`, otherwise `null`.
 */
export type PlaudConnectionBannerState = "reconnect" | "ending-soon" | null;

/** Pick the dashboard banner for a Plaud connection. Pure; safe on the client. */
export function plaudConnectionBannerState({
    needsReconnect,
    sessionExpiresAt,
    now,
}: {
    needsReconnect: boolean;
    sessionExpiresAt: Date | string | null | undefined;
    now: Date | number;
}): PlaudConnectionBannerState {
    if (needsReconnect) return "reconnect";
    if (!sessionExpiresAt) return null;
    const endsAt = new Date(sessionExpiresAt).getTime();
    if (Number.isNaN(endsAt)) return null;
    const nowMs = typeof now === "number" ? now : now.getTime();
    if (endsAt <= nowMs) return "reconnect";
    if (endsAt - nowMs <= PLAUD_SESSION_WARNING_WINDOW_MS) return "ending-soon";
    return null;
}
