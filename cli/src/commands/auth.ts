import { Command } from "commander";
import { PLAUD_SERVERS, type PlaudServerKey } from "@/lib/plaud/servers";
import { PlaudClient } from "@/lib/plaud/client";
import {
    type CliConfig,
    getConfigDir,
    loadConfig,
    saveConfig,
} from "../config";

const SERVER_KEYS = Object.keys(PLAUD_SERVERS).filter(
    (k) => k !== "custom",
) as PlaudServerKey[];

export const authCommand = new Command("auth")
    .description("Configure Plaud API credentials and Whisper settings")
    .option(
        "-t, --token <token>",
        "Plaud bearer token (from browser DevTools)",
    )
    .option(
        "-s, --server <server>",
        `Plaud API server: ${SERVER_KEYS.join(", ")}, or a custom URL`,
    )
    .option(
        "--whisper-key <key>",
        "OpenAI-compatible API key for Whisper transcription",
    )
    .option(
        "--whisper-url <url>",
        "OpenAI-compatible base URL (e.g. https://api.groq.com/openai/v1)",
    )
    .option(
        "--whisper-model <model>",
        "Whisper model name (default: whisper-1)",
    )
    .option("--show", "Show current configuration (redacted)")
    .action(async (opts) => {
        if (opts.show) {
            return showConfig();
        }

        const existing = loadConfig();

        if (
            !opts.token &&
            !opts.whisperKey &&
            !opts.whisperUrl &&
            !opts.whisperModel &&
            !existing
        ) {
            console.error("Usage: openplaud auth --token <bearer-token>");
            console.error("");
            console.error("Required for first setup:");
            console.error(
                "  --token <token>    Bearer token from plaud.ai DevTools",
            );
            console.error("");
            console.error("Optional:");
            console.error(
                `  --server <server>  API server: ${SERVER_KEYS.join(", ")} (default: eu)`,
            );
            console.error(
                "  --whisper-key      API key for Whisper transcription",
            );
            console.error(
                "  --whisper-url      Base URL for OpenAI-compatible Whisper API",
            );
            console.error(
                "  --whisper-model    Whisper model (default: whisper-1)",
            );
            console.error("");
            console.error("Show current config:");
            console.error("  openplaud auth --show");
            process.exit(1);
        }

        // Resolve API server — only overwrite when --server was explicitly passed
        let apiServer: PlaudServerKey = existing?.apiServer ?? "eu";
        let customApiBase: string | undefined = existing?.customApiBase;

        if (opts.server !== undefined) {
            if (opts.server in PLAUD_SERVERS) {
                apiServer = opts.server as PlaudServerKey;
                customApiBase = undefined;
            } else if (opts.server.startsWith("https://")) {
                // Validate the hostname is exactly plaud.ai or a subdomain of it
                let hostname: string;
                try {
                    hostname = new URL(opts.server).hostname;
                } catch {
                    console.error(
                        `Invalid server URL: ${opts.server}`,
                    );
                    process.exit(1);
                }
                if (
                    hostname !== "plaud.ai" &&
                    !hostname.endsWith(".plaud.ai")
                ) {
                    console.error(
                        `Custom server must be a plaud.ai domain (got: ${hostname})`,
                    );
                    process.exit(1);
                }
                apiServer = "custom";
                customApiBase = opts.server.replace(/\/+$/, "");
            } else {
                console.error(
                    `Invalid server. Use one of: ${SERVER_KEYS.join(", ")} or a https://*.plaud.ai URL`,
                );
                process.exit(1);
            }
        }

        const config: CliConfig = {
            bearerToken: opts.token ?? existing?.bearerToken ?? "",
            apiServer,
            customApiBase,
            whisperApiKey:
                opts.whisperKey ?? existing?.whisperApiKey ?? undefined,
            whisperBaseUrl:
                opts.whisperUrl ?? existing?.whisperBaseUrl ?? undefined,
            whisperModel:
                opts.whisperModel ?? existing?.whisperModel ?? undefined,
        };

        if (!config.bearerToken) {
            console.error("Bearer token is required. Use --token <token>");
            process.exit(1);
        }

        // Validate the bearer token by trying to list devices
        process.stdout.write("Validating bearer token... ");
        const apiBase =
            apiServer === "custom" && customApiBase
                ? customApiBase
                : PLAUD_SERVERS[
                      apiServer as Exclude<PlaudServerKey, "custom">
                  ]?.apiBase ?? PLAUD_SERVERS.global.apiBase;

        const client = new PlaudClient(config.bearerToken, apiBase);
        try {
            const valid = await client.testConnection();
            if (!valid) {
                console.error(
                    "FAILED\nBearer token is invalid or expired. Get a fresh one from plaud.ai DevTools.",
                );
                process.exit(1);
            }
            console.log("OK");
        } catch (err) {
            console.error(
                `FAILED\n${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }

        saveConfig(config);
        console.log(`Configuration saved to ${getConfigDir()}/config.json`);
        showConfig(config);
    });

function showConfig(config?: CliConfig | null): void {
    const c = config ?? loadConfig();
    if (!c) {
        console.log("Not configured. Run `openplaud auth` first.");
        return;
    }

    const redact = (s: string | undefined) =>
        s ? `${s.slice(0, 8)}...${s.slice(-4)}` : "(not set)";

    const serverLabel =
        c.apiServer === "custom"
            ? c.customApiBase ?? "custom (no URL)"
            : PLAUD_SERVERS[c.apiServer as Exclude<PlaudServerKey, "custom">]
                  ?.label ?? c.apiServer;

    console.log("");
    console.log("  Plaud API");
    console.log(`    Token:   ${redact(c.bearerToken)}`);
    console.log(`    Server:  ${serverLabel}`);
    console.log("");
    console.log("  Whisper (transcription)");
    console.log(`    API Key: ${redact(c.whisperApiKey)}`);
    console.log(`    Base URL: ${c.whisperBaseUrl || "(default: OpenAI)"}`);
    console.log(`    Model:   ${c.whisperModel || "whisper-1"}`);
    console.log("");
}
