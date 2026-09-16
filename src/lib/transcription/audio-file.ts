import { sniffAudio } from "@/lib/audio/sniff";
import { getAudioMimeType } from "@/lib/utils";

export interface BuildAudioFileResult {
    file: File;
    contentType: string;
}

export interface AudioFileMetadata {
    filename: string;
    contentType: string;
}

/** Resolve a provider filename and MIME type from an audio header. */
export function getAudioFileMetadata(
    audioHeader: Buffer,
    storagePath: string,
    decryptedFilename: string,
): AudioFileMetadata {
    const sniffed = sniffAudio(audioHeader);
    const known = sniffed.container !== "unknown";
    const ext = known
        ? sniffed.extension
        : storagePath.split(".").pop()?.toLowerCase() || "mp3";
    const contentType = known
        ? sniffed.contentType
        : getAudioMimeType(storagePath);

    return {
        filename: withAudioExtension(decryptedFilename, ext),
        contentType,
    };
}

/** Build the `File` passed to `openai.audio.transcriptions.create`. */
export function buildAudioFile(
    audioBuffer: Buffer,
    storagePath: string,
    decryptedFilename: string,
): BuildAudioFileResult {
    const { filename, contentType } = getAudioFileMetadata(
        audioBuffer,
        storagePath,
        decryptedFilename,
    );

    const view = new Uint8Array(
        audioBuffer.buffer as ArrayBuffer,
        audioBuffer.byteOffset,
        audioBuffer.byteLength,
    );
    const file = new File([view], filename, {
        type: contentType,
    });

    return { file, contentType };
}

function withAudioExtension(name: string, ext: string): string {
    if (/\.\w{2,4}$/.test(name)) {
        return name.replace(/\.\w{2,4}$/, `.${ext}`);
    }
    return `${name}.${ext}`;
}
