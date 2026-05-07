import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { requireConfig } from "../config";
import { createClient } from "../client";
import { transcribeAudio, DEFAULT_WHISPER_MODEL } from "../transcription";
import type { PlaudRecording } from "@/types/plaud";
import type { PlaudClient } from "@/lib/plaud/client";

const SEARCH_PAGE_SIZE = 100;

/**
 * Find a recording by ID using paginated search.
 * The Plaud API doesn't expose a single-recording endpoint,
 * so we page through until we find it.
 *
 * No hard page cap — we search until the API returns fewer
 * results than the page size (indicating the last page).
 */
async function findRecordingById(
    client: PlaudClient,
    id: string,
): Promise<PlaudRecording | null> {
    let skip = 0;
    while (true) {
        const response = await client.getRecordings(
            skip,
            SEARCH_PAGE_SIZE,
            0,
            "edit_time",
            true,
        );
        const page = response.data_file_list;
        const match = page.find((r) => r.id === id);
        if (match) return match;
        if (page.length < SEARCH_PAGE_SIZE) break;
        skip += SEARCH_PAGE_SIZE;
    }
    return null;
}

export const transcribeCommand = new Command("transcribe")
    .description(
        "Download and transcribe a recording (downloads audio, sends to Whisper, outputs text)",
    )
    .argument("<id>", "Recording ID (from `openplaud recordings`)")
    .option(
        "-o, --output <path>",
        "Write transcription to file instead of stdout",
    )
    .option(
        "-l, --language <lang>",
        "Language hint for Whisper (ISO 639-1, e.g. 'de', 'en')",
    )
    .option("--json", "Output as JSON with metadata")
    .action(async (id: string, opts) => {
        const config = requireConfig();
        const client = createClient(config);

        try {
            // Find recording metadata
            process.stderr.write(`Fetching recording ${id}... `);
            const recording = await findRecordingById(client, id);

            if (!recording) {
                process.stderr.write("\n");
                console.error(`Recording ${id} not found.`);
                process.exit(1);
            }
            process.stderr.write("OK\n");

            // Download audio
            process.stderr.write("Downloading audio... ");
            const audioBuffer = await client.downloadRecording(id, false);
            const sizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(1);
            process.stderr.write(`OK (${sizeMB} MB)\n`);

            // Transcribe
            const model = config.whisperModel || DEFAULT_WHISPER_MODEL;
            process.stderr.write(`Transcribing with ${model}... `);
            const text = await transcribeAudio(audioBuffer, config, {
                language: opts.language,
                filename: `${recording.filename || id}.mp3`,
            });
            process.stderr.write("OK\n");

            // Output
            if (opts.json) {
                const result = {
                    id: recording.id,
                    filename: recording.filename,
                    duration_ms: recording.duration,
                    recorded_at: new Date(recording.start_time).toISOString(),
                    device: recording.serial_number,
                    transcription: text,
                    model,
                    transcribed_at: new Date().toISOString(),
                };
                const jsonStr = JSON.stringify(result, null, 2);
                if (opts.output) {
                    writeFileSync(resolve(opts.output), jsonStr);
                    process.stderr.write(
                        `Written to: ${resolve(opts.output)}\n`,
                    );
                } else {
                    console.log(jsonStr);
                }
            } else {
                if (opts.output) {
                    writeFileSync(resolve(opts.output), text);
                    process.stderr.write(
                        `Written to: ${resolve(opts.output)}\n`,
                    );
                } else {
                    console.log(text);
                }
            }
        } catch (err) {
            console.error(
                `\nFailed to transcribe: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }
    });
