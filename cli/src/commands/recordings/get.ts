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
import type { V1RecordingDetail } from "../../lib/types.js";

export default defineCommand({
    meta: {
        name: "get",
        description:
            "Fetch a single recording with transcript and summary if available.",
    },
    args: {
        id: {
            type: "positional",
            description: "Recording id.",
            required: true,
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

        const recording = await client.request<V1RecordingDetail>(
            `/api/v1/recordings/${encodeURIComponent(args.id as string)}`,
        );

        if (args.json === true) {
            printJson(recording);
            return;
        }

        printLine(`id:         ${recording.id}`);
        printLine(`title:      ${recording.title}`);
        printLine(`recorded:   ${formatTimestamp(recording.recorded_at)}`);
        printLine(`updated:    ${formatTimestamp(recording.updated_at)}`);
        printLine(`duration:   ${formatDuration(recording.duration_ms)}`);
        printLine(`filesize:   ${formatBytes(recording.filesize_bytes)}`);
        if (recording.device) {
            printLine(
                `device:     ${recording.device.serial_number}${recording.device.name ? ` (${recording.device.name})` : ""}`,
            );
        }
        printLine("");
        if (recording.transcript) {
            printLine(
                `transcript [${recording.transcript.provider}/${recording.transcript.model}${recording.transcript.language ? `, ${recording.transcript.language}` : ""}]:`,
            );
            printLine(recording.transcript.text);
            printLine("");
        } else {
            printLine("transcript: (none)");
        }
        if (recording.summary) {
            printLine(
                `summary [${recording.summary.provider}/${recording.summary.model}]:`,
            );
            if (recording.summary.text) printLine(recording.summary.text);
            if (
                recording.summary.key_points &&
                recording.summary.key_points.length > 0
            ) {
                printLine("");
                printLine("key points:");
                for (const point of recording.summary.key_points) {
                    printLine(`  - ${point}`);
                }
            }
            if (
                recording.summary.action_items &&
                recording.summary.action_items.length > 0
            ) {
                printLine("");
                printLine("action items:");
                for (const item of recording.summary.action_items) {
                    printLine(`  - ${item}`);
                }
            }
        } else {
            printLine("summary:    (none)");
        }
    },
});
