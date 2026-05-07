import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { requireConfig } from "../config";
import { loadState, saveState } from "../config";
import { createClient } from "../client";
import { transcribeAudio, DEFAULT_WHISPER_MODEL } from "../transcription";
import { formatDuration, parseSince } from "../format";
import type { PlaudRecording } from "@/types/plaud";

const PAGE_SIZE = 50;

export const syncCommand = new Command("sync")
    .description(
        "Sync new recordings: download audio, optionally transcribe, output results",
    )
    .option(
        "--since <date>",
        "Only sync recordings after this date (default: last sync time)",
    )
    .option("--no-transcribe", "Skip transcription, only download audio")
    .option(
        "-o, --output-dir <dir>",
        "Directory to save audio and transcriptions",
        ".",
    )
    .option(
        "-l, --language <lang>",
        "Language hint for Whisper (ISO 639-1, e.g. 'de', 'en')",
    )
    .option(
        "--dry-run",
        "Show what would be synced without downloading or transcribing",
    )
    .option("--json", "Output sync results as JSON")
    .action(async (opts) => {
        const config = requireConfig();
        const client = createClient(config);
        const state = loadState();

        // Determine cutoff time
        let sinceMs: number;
        if (opts.since) {
            sinceMs = parseSince(opts.since);
        } else if (state.lastSyncAt) {
            sinceMs = new Date(state.lastSyncAt).getTime();
        } else {
            // First sync ever — get everything from the last 24 hours
            sinceMs = Date.now() - 24 * 60 * 60 * 1000;
            console.log(
                "First sync — fetching recordings from the last 24 hours.",
            );
            console.log(
                "Use --since to go further back (e.g. --since 7d).\n",
            );
        }

        try {
            // Fetch all recordings, paginated — sort by start_time so our
            // cutoff filter aligns with pagination order (newest first).
            const newRecordings: PlaudRecording[] = [];
            let skip = 0;
            let hasMore = true;

            process.stderr.write("Checking for new recordings... ");

            while (hasMore) {
                const response = await client.getRecordings(
                    skip,
                    PAGE_SIZE,
                    0, // not trash
                    "start_time", // sort by recording time, not edit time
                    true, // descending (newest first)
                );
                const page = response.data_file_list;

                if (page.length === 0) break;

                for (const rec of page) {
                    // Since we sort by start_time descending, once we hit
                    // a recording older than our cutoff we can stop entirely.
                    if (rec.start_time < sinceMs) {
                        hasMore = false;
                        break;
                    }

                    // Skip recordings we've already synced at this version
                    const knownVersion = state.knownRecordings?.[rec.id];
                    if (knownVersion && knownVersion >= rec.version_ms) {
                        continue;
                    }

                    newRecordings.push(rec);
                }

                if (page.length < PAGE_SIZE) {
                    hasMore = false;
                }
                skip += PAGE_SIZE;
            }

            console.log(`found ${newRecordings.length} new recording(s).`);

            if (newRecordings.length === 0) {
                return;
            }

            if (opts.dryRun) {
                console.log("\nDry run — would sync:\n");
                for (const rec of newRecordings) {
                    const duration = formatDuration(rec.duration);
                    const date = new Date(rec.start_time).toLocaleString();
                    console.log(
                        `  ${rec.filename || "(untitled)"} — ${duration} — ${date}`,
                    );
                    console.log(`    ID: ${rec.id}`);
                }
                return;
            }

            // Ensure output directory exists
            const outputDir = resolve(opts.outputDir);
            mkdirSync(outputDir, { recursive: true });

            const results: SyncResult[] = [];
            let anySucceeded = false;

            for (let i = 0; i < newRecordings.length; i++) {
                const rec = newRecordings[i];
                const label = rec.filename || rec.id;
                const progress = `[${i + 1}/${newRecordings.length}]`;

                process.stderr.write(
                    `${progress} ${label}: downloading... `,
                );

                try {
                    // Download audio
                    const audioBuffer = await client.downloadRecording(
                        rec.id,
                        false,
                    );
                    const baseName =
                        rec.filename.replace(/[/\\:*?"<>|]/g, "-").trim() ||
                        rec.id;
                    // Include recording ID suffix to prevent filename collisions
                    const shortId = rec.id.slice(-8);
                    const safeName =
                        baseName === rec.id
                            ? baseName
                            : `${baseName}_${shortId}`;
                    const audioPath = resolve(outputDir, `${safeName}.mp3`);
                    writeFileSync(audioPath, audioBuffer);
                    const sizeMB = (
                        audioBuffer.length /
                        (1024 * 1024)
                    ).toFixed(1);
                    process.stderr.write(`OK (${sizeMB} MB)`);

                    let transcription: string | undefined;
                    let transcriptionFailed = false;

                    // Transcribe if configured and not skipped
                    if (opts.transcribe !== false && config.whisperApiKey) {
                        const model =
                            config.whisperModel || DEFAULT_WHISPER_MODEL;
                        process.stderr.write(` → transcribing (${model})... `);
                        try {
                            transcription = await transcribeAudio(
                                audioBuffer,
                                config,
                                {
                                    language: opts.language,
                                    filename: `${safeName}.mp3`,
                                },
                            );
                            const txtPath = resolve(
                                outputDir,
                                `${safeName}.txt`,
                            );
                            writeFileSync(txtPath, transcription);
                            process.stderr.write("OK");
                        } catch (err) {
                            transcriptionFailed = true;
                            process.stderr.write(
                                `FAILED (${err instanceof Error ? err.message : String(err)})`,
                            );
                        }
                    }

                    process.stderr.write("\n");

                    const status = transcriptionFailed
                        ? "transcription_failed"
                        : "ok";
                    results.push({
                        id: rec.id,
                        filename: rec.filename,
                        audioPath,
                        transcription,
                        durationMs: rec.duration,
                        recordedAt: new Date(rec.start_time).toISOString(),
                        status,
                    });

                    // Only mark as synced if fully successful — failed
                    // transcriptions will be retried on the next sync run
                    if (!transcriptionFailed) {
                        if (!state.knownRecordings)
                            state.knownRecordings = {};
                        state.knownRecordings[rec.id] = rec.version_ms;
                    }
                    anySucceeded = true;
                } catch (err) {
                    process.stderr.write(
                        `FAILED (${err instanceof Error ? err.message : String(err)})\n`,
                    );
                    results.push({
                        id: rec.id,
                        filename: rec.filename,
                        status: "error",
                        error:
                            err instanceof Error
                                ? err.message
                                : String(err),
                    });
                }
            }

            // Advance lastSyncAt carefully: if any recordings still need
            // retry (transcription failed or download error), set the cutoff
            // just before the oldest unfinished recording so it's re-fetched
            // on the next default sync.  If everything succeeded, advance to now.
            const needsRetry = results.filter((r) => r.status !== "ok");
            if (needsRetry.length > 0) {
                const oldestRetryMs = Math.min(
                    ...newRecordings
                        .filter((rec) =>
                            needsRetry.some((r) => r.id === rec.id),
                        )
                        .map((rec) => rec.start_time),
                );
                // Set cutoff 1 ms before the oldest unfinished recording
                state.lastSyncAt = new Date(oldestRetryMs - 1).toISOString();
            } else if (anySucceeded) {
                state.lastSyncAt = new Date().toISOString();
            }
            saveState(state);

            // Summary
            const succeeded = results.filter((r) => r.status === "ok");
            const failed = results.filter((r) => r.status === "error");
            const txFailed = results.filter(
                (r) => r.status === "transcription_failed",
            );

            if (opts.json) {
                console.log(JSON.stringify(results, null, 2));
            } else {
                let summary = `\nSync complete: ${succeeded.length} succeeded, ${failed.length} failed.`;
                if (txFailed.length > 0) {
                    summary += ` ${txFailed.length} transcription(s) failed (will retry next sync).`;
                }
                console.log(summary);

                if (succeeded.length > 0) {
                    console.log(`\nTranscriptions saved to: ${outputDir}`);
                }
            }
        } catch (err) {
            console.error(
                `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }
    });

interface SyncResult {
    id: string;
    filename: string;
    audioPath?: string;
    transcription?: string;
    durationMs?: number;
    recordedAt?: string;
    status: "ok" | "error" | "transcription_failed";
    error?: string;
}
