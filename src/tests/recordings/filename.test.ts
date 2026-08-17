import { describe, expect, it } from "vitest";
import {
    audioExtension,
    buildDownloadFilename,
    contentDispositionAttachment,
    isAudioDownloadRequest,
    MAX_RECORDING_TITLE_LENGTH,
    normalizeRecordingTitle,
    recordingAudioDownloadPath,
    sanitizeDownloadBasename,
} from "@/lib/recordings/filename";

describe("normalizeRecordingTitle", () => {
    it("trims and strips control characters", () => {
        expect(normalizeRecordingTitle("  Q4 planning\u0000  ")).toBe(
            "Q4 planning",
        );
        expect(normalizeRecordingTitle("\n\t")).toBe("");
    });
});

describe("audioExtension", () => {
    it("reads the trailing extension, defaulting to mp3", () => {
        expect(audioExtension("user-1/rec.wav")).toBe("wav");
        expect(audioExtension("user-1/rec.M4A")).toBe("m4a");
        expect(audioExtension("user-1/rec")).toBe("mp3");
    });
});

describe("sanitizeDownloadBasename", () => {
    it("replaces filesystem-illegal characters", () => {
        expect(sanitizeDownloadBasename('foo/bar:baz*"<>|')).toBe(
            "foo-bar-baz-----",
        );
    });

    it("collapses illegal characters and returns empty for whitespace", () => {
        expect(sanitizeDownloadBasename("///")).toBe("---");
        expect(sanitizeDownloadBasename("   ")).toBe("");
    });

    it("truncates to the shared title cap", () => {
        const long = "a".repeat(MAX_RECORDING_TITLE_LENGTH + 40);
        expect(sanitizeDownloadBasename(long).length).toBe(
            MAX_RECORDING_TITLE_LENGTH,
        );
    });
});

describe("buildDownloadFilename", () => {
    it("appends the storage extension and falls back to the recording id", () => {
        expect(
            buildDownloadFilename("Planning Call", "u/rec.mp3", "rec-1"),
        ).toBe("Planning Call.mp3");
        expect(buildDownloadFilename("   ", "u/rec.wav", "rec-1")).toBe(
            "rec-1.wav",
        );
    });

    it("does not double the extension when the title already has it", () => {
        expect(buildDownloadFilename("memo.m4a", "u/file.m4a", "id")).toBe(
            "memo.m4a",
        );
        expect(buildDownloadFilename("memo.MP3", "u/file.mp3", "id")).toBe(
            "memo.mp3",
        );
    });

    it("keeps unicode in the download name", () => {
        expect(buildDownloadFilename("会議 日本語", "u/a.mp3", "id")).toBe(
            "会議 日本語.mp3",
        );
    });
});

describe("contentDispositionAttachment", () => {
    it("emits ASCII filename plus RFC 5987 filename*", () => {
        const header = contentDispositionAttachment("会議.mp3");
        expect(header).toContain('filename="__.mp3"');
        expect(header).toContain("filename*=UTF-8''");
        expect(header).toContain(encodeURIComponent("会議.mp3"));
    });

    it("escapes quotes in the ASCII fallback", () => {
        const header = contentDispositionAttachment('say "hi".mp3');
        expect(header).toContain('filename="say _hi_.mp3"');
    });
});

describe("isAudioDownloadRequest / recordingAudioDownloadPath", () => {
    it("treats download=1/true/yes as a download", () => {
        expect(
            isAudioDownloadRequest(
                new Request(
                    "http://localhost/api/recordings/x/audio?download=1",
                ),
            ),
        ).toBe(true);
        expect(
            isAudioDownloadRequest(
                new Request(
                    "http://localhost/api/recordings/x/audio?download=true",
                ),
            ),
        ).toBe(true);
        expect(
            isAudioDownloadRequest(
                new Request("http://localhost/api/recordings/x/audio"),
            ),
        ).toBe(false);
        expect(
            isAudioDownloadRequest(
                new Request(
                    "http://localhost/api/recordings/x/audio?download=0",
                ),
            ),
        ).toBe(false);
    });

    it("builds the session-cookie download path", () => {
        expect(recordingAudioDownloadPath("rec-1")).toBe(
            "/api/recordings/rec-1/audio?download=1",
        );
    });
});
