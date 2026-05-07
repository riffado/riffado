import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PlaudServerKey } from "@/lib/plaud/servers";

const CONFIG_DIR = join(homedir(), ".config", "openplaud-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const STATE_FILE = join(CONFIG_DIR, "state.json");

export interface CliConfig {
    /** Plaud API bearer token (without "Bearer " prefix) */
    bearerToken: string;
    /** Which Plaud API server to use */
    apiServer: PlaudServerKey;
    /** Custom API base URL (only used when apiServer is "custom") */
    customApiBase?: string;
    /** OpenAI-compatible API key for Whisper transcription */
    whisperApiKey?: string;
    /** OpenAI-compatible base URL (e.g. https://api.groq.com/openai/v1) */
    whisperBaseUrl?: string;
    /** Whisper model to use (default: whisper-1) */
    whisperModel?: string;
}

export interface CliState {
    /** ISO timestamp of last successful sync */
    lastSyncAt?: string;
    /** Map of plaudFileId → version_ms for tracking changes */
    knownRecordings?: Record<string, number>;
}

function ensureConfigDir(): void {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
}

export function loadConfig(): CliConfig | null {
    if (!existsSync(CONFIG_FILE)) return null;
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as CliConfig;
    } catch {
        return null;
    }
}

export function saveConfig(config: CliConfig): void {
    ensureConfigDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4), {
        encoding: "utf-8",
        mode: 0o600,
    });
    // Ensure permissions are correct even if the file already existed
    chmodSync(CONFIG_FILE, 0o600);
}

export function loadState(): CliState {
    if (!existsSync(STATE_FILE)) return {};
    try {
        return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as CliState;
    } catch {
        return {};
    }
}

export function saveState(state: CliState): void {
    ensureConfigDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 4), {
        encoding: "utf-8",
        mode: 0o600,
    });
    // Ensure permissions are correct even if the file already existed
    chmodSync(STATE_FILE, 0o600);
}

export function requireConfig(): CliConfig {
    const config = loadConfig();
    if (!config) {
        console.error(
            "Not configured. Run `openplaud auth` first to set up your credentials.",
        );
        process.exit(1);
    }
    return config;
}

export function getConfigDir(): string {
    return CONFIG_DIR;
}
