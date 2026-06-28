import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { defineCommand } from "citty";
import { ApiClient, ApiError } from "../../lib/client.js";
import { loadConfig } from "../../lib/config.js";
import { printError, printSuccess } from "../../lib/output.js";

function extensionFromContentType(contentType: string | null): string {
    if (!contentType) return ".bin";
    const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (base.includes("mpeg") || base.includes("mp3")) return ".mp3";
    if (base.includes("wav")) return ".wav";
    if (base.includes("ogg")) return ".ogg";
    if (base.includes("webm")) return ".webm";
    if (base.includes("flac")) return ".flac";
    if (base.includes("aac") || base.includes("mp4")) return ".m4a";
    return ".bin";
}

export default defineCommand({
    meta: {
        name: "download",
        description: "Download a recording's audio file.",
    },
    args: {
        id: {
            type: "positional",
            description: "Recording id.",
            required: true,
        },
        out: {
            type: "string",
            description:
                "Output path (default: ./<id><ext> based on Content-Type).",
        },
    },
    async run({ args }) {
        const config = loadConfig();
        const client = new ApiClient({
            server: config.server,
            apiKey: config.apiKey,
        });
        const id = args.id as string;

        // Use rawFetch so we can stream the body and follow the S3 redirect
        // (302) without parsing JSON.
        const response = await client.rawFetch(
            `/api/v1/recordings/${encodeURIComponent(id)}/audio`,
            { method: "GET", redirect: "follow" },
        );

        if (!response.ok) {
            const text = await response.text();
            let message = `Audio download failed (HTTP ${response.status})`;
            let code: string | undefined;
            try {
                const parsed = JSON.parse(text) as {
                    error?: string;
                    code?: string;
                };
                if (parsed.error) message = parsed.error;
                if (parsed.code) code = parsed.code;
            } catch {
                if (text.length > 0)
                    message = `${message}: ${text.slice(0, 200)}`;
            }
            throw new ApiError(response.status, {
                error: message,
                code: code ?? "AUDIO_DOWNLOAD_FAILED",
            });
        }

        const explicitOut = args.out as string | undefined;
        const outPath =
            explicitOut ??
            `${id}${extensionFromContentType(response.headers.get("content-type"))}`;

        if (!response.body) {
            printError("Server returned no audio body.");
            process.exit(1);
        }

        const fileStream = createWriteStream(outPath);
        await pipeline(Readable.fromWeb(response.body as never), fileStream);
        printSuccess(`Saved to ${outPath}`);
    },
});
