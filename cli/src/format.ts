/**
 * Shared formatting and parsing utilities for CLI commands.
 */

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

export function formatDate(timestampMs: number): string {
    return new Date(timestampMs).toLocaleString();
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parse a time reference into a Unix timestamp (ms).
 * Accepts ISO 8601 dates or relative durations: "2h", "30m", "7d", "1w"
 */
export function parseSince(value: string): number {
    // Relative duration: "2h", "30m", "7d", "1w"
    const relMatch = value.match(/^(\d+)(m|h|d|w)$/);
    if (relMatch) {
        const amount = Number.parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const multipliers: Record<string, number> = {
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
        };
        return Date.now() - amount * multipliers[unit];
    }

    // ISO 8601 or any parseable date string
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }

    console.error(
        `Cannot parse time value: "${value}". Use ISO 8601 or relative (e.g. "2h", "7d")`,
    );
    process.exit(1);
}
