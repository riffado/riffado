import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: ["small", "ui", "pane-title", "section-title", "dialog-body"],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const isBuild = process.env.NEXT_PHASE === "phase-production-build";
export const isDev = process.env.NODE_ENV === "development";

const AUDIO_MIME_TYPES: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
};

/**
 * Returns the correct MIME type for an audio file path based on its extension.
 * Falls back to audio/mpeg when the extension is not recognised.
 */
export function getAudioMimeType(filePath: string): string {
    const lower = filePath.toLowerCase();
    for (const [ext, mime] of Object.entries(AUDIO_MIME_TYPES)) {
        if (lower.endsWith(ext)) return mime;
    }
    return "audio/mpeg";
}

/**
 * Returns a filename with the correct extension for use when constructing
 * a File object sent to an audio transcription API.
 */
export function audioFilenameWithExt(storagePath: string): string {
    const lower = storagePath.toLowerCase();
    for (const ext of Object.keys(AUDIO_MIME_TYPES)) {
        if (lower.endsWith(ext)) return `audio${ext}`;
    }
    return "audio.mp3";
}

export function absoluteUrl(path: string) {
    if (typeof window !== "undefined") {
        return `${window.location.origin}${path}`;
    }
    const { env } = require("@/lib/env");
    return `${env.APP_URL}${path}`;
}
