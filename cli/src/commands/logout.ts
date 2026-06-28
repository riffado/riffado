import { defineCommand } from "citty";
import { ApiClient, ApiError } from "../lib/client.js";
import { clearConfig, loadConfigOrNull } from "../lib/config.js";
import {
    printError,
    printLine,
    printSuccess,
    printWarning,
} from "../lib/output.js";

export default defineCommand({
    meta: {
        name: "logout",
        description: "Remove the local Riffado CLI credentials.",
    },
    args: {
        revoke: {
            type: "boolean",
            description:
                "Also revoke the API key on the server (only works when the key id is known).",
            default: false,
        },
    },
    async run({ args }) {
        const config = loadConfigOrNull();
        if (!config) {
            printLine("Not logged in. Nothing to do.");
            return;
        }

        if (args.revoke === true) {
            if (!config.apiKeyId) {
                printWarning(
                    "Server-side revoke skipped: this key was not minted by the CLI, so its id is unknown. Revoke it manually from Settings → API Keys.",
                );
            } else {
                const client = new ApiClient({
                    server: config.server,
                    apiKey: config.apiKey,
                });
                try {
                    await client.request(
                        `/api/settings/api-keys/${config.apiKeyId}`,
                        {
                            method: "DELETE",
                        },
                    );
                } catch (error) {
                    if (error instanceof ApiError) {
                        printError(
                            `Failed to revoke key on server: ${error.message}`,
                            error.code,
                        );
                    } else {
                        printError(
                            error instanceof Error
                                ? error.message
                                : String(error),
                        );
                    }
                    process.exit(1);
                }
            }
        }

        clearConfig();
        printSuccess("Local credentials cleared.");
    },
});
