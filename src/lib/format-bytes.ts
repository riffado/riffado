/**
 * Format a byte count as a human-readable string using binary units (1024).
 *
 * - 0 bytes -> "0 B"
 * - < 1 KB -> integer bytes (e.g. "512 B")
 * - >= 1 KB -> two decimal places (e.g. "1.21 GB")
 *
 * Negative or non-finite inputs are clamped to 0.
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
    // Clamp to [0, units.length - 1]: bytes < 1 would otherwise yield a
    // negative exponent and an undefined unit.
    const exponent = Math.min(
        Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))),
        units.length - 1,
    );

    if (exponent === 0) {
        return `${Math.round(bytes)} B`;
    }

    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(2)} ${units[exponent]}`;
}
