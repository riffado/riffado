import { defineCommand } from "citty";
import { ApiClient, ApiError, NetworkError } from "../lib/client.js";
import {
    type CliConfig,
    DEFAULT_SERVER,
    maskApiKey,
    saveConfig,
} from "../lib/config.js";
import { printError, printSuccess } from "../lib/output.js";
import { promptSecret } from "../lib/prompt.js";

const HELP_PROBE_PATH = "/api/v1/recordings?limit=1";

export default defineCommand({
    meta: {
        name: "login",
        description: "Authenticate the CLI by storing a Riffado API key.",
    },
    args: {
        "api-key": {
            type: "string",
            description:
                "API key to use (alternatively: pipe via stdin or set RIFFADO_API_KEY).",
        },
        server: {
            type: "string",
            description: `Riffado server URL (default: ${DEFAULT_SERVER}).`,
        },
    },
    async run({ args }) {
        const server =
            (args.server as string | undefined) ??
            process.env.RIFFADO_SERVER ??
            DEFAULT_SERVER;

        let apiKey: string | undefined =
            (args["api-key"] as string | undefined) ??
            process.env.RIFFADO_API_KEY;

        if (!apiKey) {
            apiKey = (
                await promptSecret("Paste your Riffado API key: ")
            ).trim();
        }

        if (!apiKey || apiKey.length === 0) {
            printError("No API key provided.");
            process.exit(1);
        }

        // Probe the API to validate the key. Server returns 401 on bad
        // keys; we treat 200 as confirmation and refuse to save invalid
        // credentials.
        const client = new ApiClient({ server, apiKey });
        try {
            await client.request(HELP_PROBE_PATH);
        } catch (error) {
            if (error instanceof ApiError) {
                printError(
                    `Server rejected the API key (HTTP ${error.status}): ${error.message}`,
                    error.code,
                );
            } else if (error instanceof NetworkError) {
                printError(error.message);
            } else {
                printError(
                    error instanceof Error ? error.message : String(error),
                );
            }
            process.exit(1);
        }

        const config: CliConfig = { server, apiKey };
        saveConfig(config);
        printSuccess(`Logged in to ${server} as ${maskApiKey(apiKey)}.`);
    },
});
