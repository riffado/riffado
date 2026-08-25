export type AudioContainer =
    | "ogg"
    | "mp3"
    | "wav"
    | "mp4"
    | "flac"
    | "aac"
    | "webm"
    | "unknown";

export type AudioCodec =
    | "opus"
    | "vorbis"
    | "mp3"
    | "pcm"
    | "aac"
    | "flac"
    | "unknown";

export interface SniffedAudio {
    container: AudioContainer;
    codec: AudioCodec;
    extension: string;
    contentType: string;
}

/**
 * Detect audio container and codec from magic bytes, ignoring filename.
 * Plaud often labels Ogg/Opus downloads as `.mp3`.
 */
export function sniffAudio(buffer: Buffer): SniffedAudio {
    if (isOggContainer(buffer)) {
        return buildSniff("ogg", detectOggCodec(buffer));
    }
    if (isWavContainer(buffer)) {
        return buildSniff("wav", "pcm");
    }
    if (isFlacContainer(buffer)) {
        return buildSniff("flac", "flac");
    }
    if (isMp4Container(buffer)) {
        return buildSniff("mp4", "aac");
    }
    if (isWebmContainer(buffer)) {
        return buildSniff("webm", "unknown");
    }
    if (isAdtsAac(buffer)) {
        return buildSniff("aac", "aac");
    }
    if (isMp3Container(buffer)) {
        return buildSniff("mp3", "mp3");
    }
    return buildSniff("unknown", "unknown");
}

export function isOggContainer(buffer: Buffer): boolean {
    return (
        buffer.length >= 4 &&
        buffer[0] === 0x4f &&
        buffer[1] === 0x67 &&
        buffer[2] === 0x67 &&
        buffer[3] === 0x53
    );
}

function isWavContainer(buffer: Buffer): boolean {
    return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WAVE"
    );
}

function isFlacContainer(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC";
}

function isMp4Container(buffer: Buffer): boolean {
    return buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp";
}

function isWebmContainer(buffer: Buffer): boolean {
    return (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
    );
}

function mpegLayerBits(secondByte: number): number {
    return (secondByte >> 1) & 0x03;
}

function isAdtsAac(buffer: Buffer): boolean {
    if (buffer.length < 2 || buffer[0] !== 0xff) return false;
    if ((buffer[1] & 0xf0) !== 0xf0) return false;
    return mpegLayerBits(buffer[1]) === 0;
}

function isMp3Container(buffer: Buffer): boolean {
    if (
        buffer.length >= 3 &&
        buffer[0] === 0x49 &&
        buffer[1] === 0x44 &&
        buffer[2] === 0x33
    ) {
        return true;
    }
    if (buffer.length < 2 || buffer[0] !== 0xff) return false;
    if ((buffer[1] & 0xe0) !== 0xe0) return false;
    return mpegLayerBits(buffer[1]) !== 0;
}

function detectOggCodec(buffer: Buffer): AudioCodec {
    if (buffer.includes(Buffer.from("OpusHead"))) return "opus";
    if (buffer.includes(Buffer.from("\x01vorbis"))) return "vorbis";
    return "unknown";
}

function buildSniff(
    container: AudioContainer,
    codec: AudioCodec,
): SniffedAudio {
    const { extension, contentType } = metaForContainer(container);
    return { container, codec, extension, contentType };
}

function metaForContainer(container: AudioContainer): {
    extension: string;
    contentType: string;
} {
    switch (container) {
        case "ogg":
            return { extension: "ogg", contentType: "audio/ogg" };
        case "mp3":
            return { extension: "mp3", contentType: "audio/mpeg" };
        case "wav":
            return { extension: "wav", contentType: "audio/wav" };
        case "mp4":
            return { extension: "m4a", contentType: "audio/mp4" };
        case "flac":
            return { extension: "flac", contentType: "audio/flac" };
        case "aac":
            return { extension: "aac", contentType: "audio/aac" };
        case "webm":
            return { extension: "webm", contentType: "audio/webm" };
        case "unknown":
            return { extension: "mp3", contentType: "audio/mpeg" };
        default: {
            const _never: never = container;
            throw new Error(`unhandled audio container: ${_never}`);
        }
    }
}
