import { defineCommand } from "citty";
import { ApiClient, ApiError } from "../lib/client.js";
import { loadConfig, maskApiKey } from "../lib/config.js";
import { printError, printJson, printLine } from "../lib/output.js";

export default defineCommand({
    meta: {
        name: "whoami",
        description:
            "Show the configured server and a masked API key, and probe the server for connectivity.",
    },
    args: {
        json: {
            type: "boolean",
            description: "Output as JSON.",
            default: false,
        },
    },
    async run({ args }) {
        const config = loadConfig();
        const client = new ApiClient({
            server: config.server,
            apiKey: config.apiKey,
        });

        let ok = false;
        let error: { status: number; code: string; message: string } | null =
            null;
        try {
            await client.request("/api/v1/recordings?limit=1");
            ok = true;
        } catch (err) {
            if (err instanceof ApiError) {
                error = {
                    status: err.status,
                    code: err.code,
                    message: err.message,
                };
            } else {
                error = {
                    status: 0,
                    code: "NETWORK_ERROR",
                    message: err instanceof Error ? err.message : String(err),
                };
            }
        }

        if (args.json === true) {
            printJson({
                server: config.server,
                api_key: maskApiKey(config.apiKey),
                ok,
                error,
            });
            return;
        }

        printLine(`server:   ${config.server}`);
        printLine(`api key:  ${maskApiKey(config.apiKey)}`);
        if (ok) {
            printLine("status:   ok");
        } else if (error) {
            printError(`probe failed: ${error.message}`, error.code);
            process.exit(1);
        }
    },
});
