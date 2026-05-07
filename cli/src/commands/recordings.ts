import { Command } from "commander";
import { requireConfig } from "../config";
import { createClient } from "../client";
import { formatDuration, formatDate, formatSize, parseSince } from "../format";
import type { PlaudRecording } from "@/types/plaud";

function printRecording(rec: PlaudRecording, index?: number): void {
    const prefix = index !== undefined ? `  ${index + 1}. ` : "  ";
    console.log(`${prefix}${rec.filename || "(untitled)"}`);
    console.log(`      ID:       ${rec.id}`);
    console.log(`      Date:     ${formatDate(rec.start_time)}`);
    console.log(`      Duration: ${formatDuration(rec.duration)}`);
    console.log(`      Size:     ${formatSize(rec.filesize)}`);
    console.log(`      Device:   ${rec.serial_number}`);
    if (rec.is_trans) console.log("      Status:   transcribed (on Plaud)");
    console.log("");
}

export const recordingsCommand = new Command("recordings")
    .description("List recordings from your Plaud account")
    .option("-n, --limit <number>", "Maximum recordings to show", "20")
    .option("--skip <number>", "Skip first N recordings", "0")
    .option(
        "--since <date>",
        "Only show recordings after this date (ISO 8601 or relative like '2h', '7d')",
    )
    .option("--trash", "Show trashed recordings instead")
    .option("--json", "Output as JSON")
    .option("--ids-only", "Output only recording IDs (one per line)")
    .action(async (opts) => {
        const config = requireConfig();
        const client = createClient(config);

        const limit = Number.parseInt(opts.limit, 10);
        const skip = Number.parseInt(opts.skip, 10);

        try {
            const response = await client.getRecordings(
                skip,
                limit,
                opts.trash ? 1 : 0,
                "edit_time",
                true,
            );

            let recordings = response.data_file_list;

            // Filter by --since if provided
            if (opts.since) {
                const sinceMs = parseSince(opts.since);
                recordings = recordings.filter(
                    (r) => r.start_time >= sinceMs,
                );
            }

            if (recordings.length === 0) {
                console.log("No recordings found.");
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(recordings, null, 2));
                return;
            }

            if (opts.idsOnly) {
                for (const rec of recordings) {
                    console.log(rec.id);
                }
                return;
            }

            console.log(
                `Showing ${recordings.length} of ${response.data_file_total} recording(s):\n`,
            );
            for (let i = 0; i < recordings.length; i++) {
                printRecording(recordings[i], i);
            }
        } catch (err) {
            console.error(
                `Failed to list recordings: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }
    });
