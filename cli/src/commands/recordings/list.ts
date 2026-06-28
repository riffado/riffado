import { defineCommand } from "citty";
import { ApiClient } from "../../lib/client.js";
import { loadConfig } from "../../lib/config.js";
import {
    formatBytes,
    formatDuration,
    formatTimestamp,
    printJson,
    printLine,
} from "../../lib/output.js";
import type { V1RecordingsList } from "../../lib/types.js";

export default defineCommand({
    meta: {
        name: "list",
        description: "List your recordings, most-recently-updated first.",
    },
    args: {
        limit: {
            type: "string",
            description: "Page size (1-100, default 50).",
        },
        cursor: {
            type: "string",
            description: "Pagination cursor from a previous response.",
        },
        json: {
            type: "boolean",
            description: "Output the raw API response as JSON.",
            default: false,
        },
    },
    async run({ args }) {
        const config = loadConfig();
        const client = new ApiClient({
            server: config.server,
            apiKey: config.apiKey,
        });

        const limitArg = args.limit as string | undefined;
        const cursorArg = args.cursor as string | undefined;

        const result = await client.request<V1RecordingsList>(
            "/api/v1/recordings",
            {
                query: {
                    limit: limitArg,
                    cursor: cursorArg,
                },
            },
        );

        if (args.json === true) {
            printJson(result);
            return;
        }

        if (result.data.length === 0) {
            printLine("No recordings found.");
            return;
        }

        for (const rec of result.data) {
            const transcript = rec.has_transcription ? "T" : "-";
            const summary = rec.has_summary ? "S" : "-";
            printLine(
                [
                    rec.id,
                    `[${transcript}${summary}]`,
                    formatTimestamp(rec.recorded_at),
                    formatDuration(rec.duration_ms).padStart(7),
                    formatBytes(rec.filesize_bytes).padStart(8),
                    rec.title,
                ].join("  "),
            );
        }
        if (result.has_more && result.next_cursor) {
            printLine("");
            printLine(
                `Next page: riffado recordings list --cursor ${result.next_cursor}`,
            );
        }
    },
});
