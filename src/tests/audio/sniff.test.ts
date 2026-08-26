import { describe, expect, it } from "vitest";
import { isOggContainer, sniffAudio } from "@/lib/audio/sniff";

function oggOpusBytes(): Buffer {
    const buf = Buffer.alloc(48, 0);
    buf.write("OggS", 0);
    buf.write("OpusHead", 28);
    return buf;
}

describe("sniffAudio", () => {
    it("detects Ogg/Opus regardless of any filename", () => {
        const sniffed = sniffAudio(oggOpusBytes());
        expect(isOggContainer(oggOpusBytes())).toBe(true);
        expect(sniffed.container).toBe("ogg");
        expect(sniffed.codec).toBe("opus");
        expect(sniffed.extension).toBe("ogg");
        expect(sniffed.contentType).toBe("audio/ogg");
    });

    it("detects WAV from RIFF/WAVE", () => {
        const buf = Buffer.alloc(12, 0);
        buf.write("RIFF", 0);
        buf.write("WAVE", 8);
        const sniffed = sniffAudio(buf);
        expect(sniffed.container).toBe("wav");
        expect(sniffed.contentType).toBe("audio/wav");
        expect(sniffed.extension).toBe("wav");
    });

    it("detects MP3 from an ID3 header", () => {
        const buf = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
        const sniffed = sniffAudio(buf);
        expect(sniffed.container).toBe("mp3");
        expect(sniffed.contentType).toBe("audio/mpeg");
        expect(sniffed.extension).toBe("mp3");
    });

    it("detects MP3 from an MPEG-1 Layer III frame sync", () => {
        const sniffed = sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
        expect(sniffed.container).toBe("mp3");
        expect(sniffed.contentType).toBe("audio/mpeg");
    });

    it("does not classify ADTS AAC (0xFFF1 / 0xFFF9) as MP3", () => {
        const f1 = sniffAudio(Buffer.from([0xff, 0xf1, 0x50, 0x80]));
        expect(f1.container).toBe("aac");
        expect(f1.contentType).toBe("audio/aac");
        expect(f1.extension).toBe("aac");

        const f9 = sniffAudio(Buffer.from([0xff, 0xf9, 0x50, 0x80]));
        expect(f9.container).toBe("aac");
        expect(f9.contentType).toBe("audio/aac");
    });

    it("falls back to mp3/mpeg for unknown bytes (legacy Plaud default)", () => {
        const sniffed = sniffAudio(Buffer.from("not-audio"));
        expect(sniffed.container).toBe("unknown");
        expect(sniffed.extension).toBe("mp3");
        expect(sniffed.contentType).toBe("audio/mpeg");
    });
});
