/**
 * Local config for the Riffado CLI.
 *
 * Stored at `$XDG_CONFIG_HOME/riffado/config.json` (falling back to
 * `~/.config/riffado/config.json`). File mode is `0600` so other local
 * users cannot read the API key.
 *
 * The shape is intentionally tiny — one server + one API key — until the
 * device-flow login (Phase 2, issue #110) adds multi-profile support.
 *
 * The API key is stored in plaintext on disk. macOS Keychain / Linux
 * Secret Service integration is a future enhancement (tracked separately);
 * the immediate priority is to never leak the key to logs, argv, or env
 * dumps. Callers read it through `loadConfig()` and pass it to the
 * `client` helper; nothing else should touch `apiKey`.
 */

import {
    chmodSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_SERVER = "https://riffado.com";

export type CliConfig = {
    server: string;
    apiKey: string;
    /**
     * The id of the api key on the server (returned by POST /api/settings/api-keys).
     * Stored so `riffado logout` can revoke server-side. Optional because
     * keys created manually in the Settings UI and pasted into the CLI
     * don't expose their id to the user.
     */
    apiKeyId?: string;
};

export function configDir(): string {
    const xdg = process.env.XDG_CONFIG_HOME;
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
    return join(base, "riffado");
}

export function configPath(): string {
    return join(configDir(), "config.json");
}

export class ConfigNotFoundError extends Error {
    constructor() {
        super("Not logged in. Run `riffado login` first.");
        this.name = "ConfigNotFoundError";
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(raw: string): CliConfig {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
        throw new Error("Config file is not a JSON object");
    }
    const { server, apiKey, apiKeyId } = parsed;
    if (typeof server !== "string" || server.length === 0) {
        throw new Error("Config is missing `server`");
    }
    if (typeof apiKey !== "string" || apiKey.length === 0) {
        throw new Error("Config is missing `apiKey`");
    }
    const config: CliConfig = { server, apiKey };
    if (typeof apiKeyId === "string" && apiKeyId.length > 0) {
        config.apiKeyId = apiKeyId;
    }
    return config;
}

export function loadConfig(): CliConfig {
    const path = configPath();
    let raw: string;
    try {
        raw = readFileSync(path, "utf-8");
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
            throw new ConfigNotFoundError();
        }
        throw error;
    }
    return parseConfig(raw);
}

export function loadConfigOrNull(): CliConfig | null {
    try {
        return loadConfig();
    } catch (error) {
        if (error instanceof ConfigNotFoundError) return null;
        throw error;
    }
}

export function saveConfig(config: CliConfig): void {
    const dir = configDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = configPath();
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
    });
    // writeFileSync only sets mode on file creation; ensure perms even on
    // overwrite of an existing file.
    try {
        chmodSync(path, 0o600);
    } catch {
        // Best-effort on platforms that don't support chmod (Windows).
    }
}

export function clearConfig(): boolean {
    const path = configPath();
    try {
        rmSync(path);
        return true;
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
            return false;
        }
        throw error;
    }
}

/**
 * Mask an API key for display: `op_abcd…wxyz`. Never logs the full key.
 */
export function maskApiKey(key: string): string {
    if (key.length <= 12) return `${key.slice(0, 4)}…`;
    return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// Re-export for test consumers that mock the home dir.
export const _internals = {
    configDir,
    configPath,
    dirname,
};
