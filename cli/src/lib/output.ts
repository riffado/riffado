/**
 * Output formatting helpers — keeps JSON vs human modes in one place so
 * commands can stay command-only without duplicating presentation logic.
 *
 * JSON mode prints exactly one JSON document per command invocation,
 * suitable for piping into `jq`. Human mode is plain text — no colors
 * by default in pipes (pico-colors detects TTY).
 */

import pc from "picocolors";

export type OutputMode = "json" | "human";

export function printJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

export function printError(message: string, code?: string): void {
    const prefix = pc.red("error");
    const suffix = code ? pc.dim(` [${code}]`) : "";
    process.stderr.write(`${prefix}${suffix}: ${message}\n`);
}

export function printWarning(message: string): void {
    process.stderr.write(`${pc.yellow("warn")}: ${message}\n`);
}

export function printSuccess(message: string): void {
    process.stdout.write(`${pc.green("ok")}: ${message}\n`);
}

/**
 * Format an ISO timestamp for human-mode tables. Returns the original
 * string if parsing fails so we never silently lose data.
 */
export function formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "Z");
}

export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0:00";
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "?";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
