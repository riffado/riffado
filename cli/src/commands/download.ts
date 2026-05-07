import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { requireConfig } from "../config";
import { createClient } from "../client";

export const downloadCommand = new Command("download")
    .description("Download a recording's audio file")
    .argument("<id>", "Recording ID (from `openplaud recordings`)")
    .option("-o, --output <path>", "Output file path (default: <id>.mp3)")
    .option("--opus", "Download in OPUS format instead of MP3")
    .action(async (id: string, opts) => {
        const config = requireConfig();
        const client = createClient(config);

        const ext = opts.opus ? "opus" : "mp3";
        const outputPath = resolve(opts.output || `${id}.${ext}`);

        try {
            process.stdout.write(`Downloading recording ${id}... `);
            const buffer = await client.downloadRecording(id, !!opts.opus);
            writeFileSync(outputPath, buffer);
            const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
            console.log(`OK (${sizeMB} MB)`);
            console.log(`Saved to: ${outputPath}`);
        } catch (err) {
            console.error(
                `\nFailed to download: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
        }
    });
