/**
 * Format a date for billing/lifecycle email copy with a pinned
 * locale + UTC timezone. Emails render server-side, so an unpinned
 * `toLocaleDateString(undefined, ...)` uses the server process's
 * locale/timezone rather than the recipient's -- if that ever differs
 * across deployments (or a container's TZ changes), the same instant
 * could render as a different calendar day, showing an inconsistent
 * cutoff/deadline date for a message that's communicating an exact
 * deletion or transition date.
 */
export function formatEmailDate(
    d: Date,
    options?: { month?: "long" | "short" },
): string {
    return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: options?.month ?? "long",
        day: "numeric",
        timeZone: "UTC",
    });
}
