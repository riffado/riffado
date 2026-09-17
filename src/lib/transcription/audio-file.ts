import { sniffAudio } from "@/lib/audio/sniff";
import { getAudioMimeType } from "@/lib/utils";

export interface BuildAudioFileResult {
    file: File;
    contentType: string;
}

/** Build the `File` passed to `openai.audio.transcriptions.create`. */
export function buildAudioFile(
    audioBuffer: Buffer,
    storagePath: string,
    decryptedFilename: string,
): BuildAudioFileResult {
    const sniffed = sniffAudio(audioBuffer);
    const known = sniffed.container !== "unknown";
    const ext = known
        ? sniffed.extension
        : storagePath.split(".").pop()?.toLowerCase() || "mp3";
    const contentType = known
        ? sniffed.contentType
        : getAudioMimeType(storagePath);

    const filename = withAudioExtension(decryptedFilename, ext);

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
