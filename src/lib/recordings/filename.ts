/** Max stored/display title length. Download basenames use the same cap. */
export const MAX_RECORDING_TITLE_LENGTH = 200;

export const AUDIO_FILE_EXTENSIONS = [
    ".mp3",
    ".mp4",
    ".m4a",
    ".wav",
    ".ogg",
    ".opus",
    ".webm",
    ".aac",
    ".flac",
] as const;

/**
 * Splits a trailing audio extension from `AUDIO_FILE_EXTENSIONS` off a
 * recording name (case-insensitive). `extension` keeps the stored casing
 * and is empty when the name has none; `base` may be empty for a name
 * that is only an extension.
 */
export function splitAudioExtension(filename: string): {
    base: string;
    extension: string;
} {
    const lower = filename.toLowerCase();
    const match = AUDIO_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext));
    if (!match) return { base: filename, extension: "" };
    return {
        base: filename.slice(0, -match.length),
        extension: filename.slice(-match.length),
    };
}

/**
 * The name to store after a rename: the stored audio extension goes back
 * on the typed name, unless the user typed a known audio extension.
 */
export function renamedRecordingFilename(
    stored: string,
    typed: string,
): string {
    const { extension } = splitAudioExtension(stored);
    if (!extension || splitAudioExtension(typed).extension) return typed;
    return `${typed}${extension}`;
}

const DOWNLOAD_PARAM_TRUE = new Set(["1", "true", "yes"]);

function stripControlChars(value: string): string {
    let out = "";
    for (const char of value) {
        const code = char.charCodeAt(0);
        if (code < 32 || code === 127) continue;
        out += char;
    }
    return out;
}

/** CON, PRN, AUX, NUL, COM1–9, LPT1–9 — reserved even with an extension. */
const WINDOWS_RESERVED_BASENAME =
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.[^.]+)?$/i;

function escapeWindowsReservedBasename(name: string): string {
    return WINDOWS_RESERVED_BASENAME.test(name) ? `_${name}` : name;
}

/**
 * Strip C0 controls and trim. Empty string means the caller should reject.
 */
export function normalizeRecordingTitle(value: string): string {
    return stripControlChars(value).trim();
}

export function audioExtension(storagePath: string): string {
    const match = storagePath.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : "mp3";
}

export function recordingAudioDownloadPath(recordingId: string): string {
    return `/api/recordings/${recordingId}/audio?download=1`;
}

/**
 * In-app playback URL. With `stream`, the route always streams the bytes
 * itself instead of redirecting to a storage URL the browser may not be
 * able to reach.
 */
export function recordingAudioPlaybackPath(
    recordingId: string,
    options: { stream: boolean },
): string {
    const path = `/api/recordings/${recordingId}/audio`;
    return options.stream ? `${path}?stream=1` : path;
}

/** True when the request asked the audio route to stream instead of redirecting. */
export function isAudioStreamRequest(request: Request): boolean {
    return new URL(request.url).searchParams.get("stream") === "1";
}

export function isAudioDownloadRequest(request: Request): boolean {
    const value = new URL(request.url).searchParams.get("download");
    if (value === null) return false;
    return DOWNLOAD_PARAM_TRUE.has(value.toLowerCase());
}

export function sanitizeDownloadBasename(title: string): string {
    const cleaned = stripControlChars(title)
        .replace(/[/\\:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) return "";
    const truncated =
        cleaned.length > MAX_RECORDING_TITLE_LENGTH
            ? cleaned.slice(0, MAX_RECORDING_TITLE_LENGTH).trim()
            : cleaned;
    return escapeWindowsReservedBasename(truncated);
}

/**
 * Filesystem-safe download name from the recording title, with the
 * extension taken from `storagePath` (mp3/wav/m4a/…). Falls back to
 * `fallbackId` when the title sanitizes to empty.
 */
export function buildDownloadFilename(
    title: string,
    storagePath: string,
    fallbackId: string,
): string {
    const ext = audioExtension(storagePath);
    const extSuffix = `.${ext}`;
    let base =
        sanitizeDownloadBasename(title) ||
        sanitizeDownloadBasename(fallbackId) ||
        "recording";
    if (base.toLowerCase().endsWith(extSuffix)) {
        base = base.slice(0, -extSuffix.length);
    }
    base = escapeWindowsReservedBasename(base);
    return `${base}${extSuffix}`;
}

/**
 * RFC 6266 / RFC 5987 Content-Disposition for an attachment download.
 * `filename` is the ASCII fallback; `filename*` carries the UTF-8 name.
 */
export function contentDispositionAttachment(filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(filename).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
