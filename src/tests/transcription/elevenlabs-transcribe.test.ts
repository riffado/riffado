/**
 * Unit tests for the ElevenLabs Scribe transcription module.
 *
 * ElevenLabs is not OpenAI-compatible: auth is `xi-api-key` (not
 * `Authorization: Bearer`), the endpoint is `/speech-to-text`, and the
 * response carries per-word `speaker_id` rather than OpenAI's
 * `segments[]` shape. These tests pin the request shape, the
 * diarization-to-text formatting, language normalization, and the
 * retry/error mapping.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ElevenLabsFileTooLargeError,
    ElevenLabsTranscribeError,
    elevenLabsTranscribe,
} from "@/lib/transcription/elevenlabs-transcribe";

function fakeFile(name = "audio.mp3"): File {
    return new File([new Uint8Array([1, 2, 3])], name, {
        type: "audio/mpeg",
    });
}

async function readForm(body: unknown): Promise<FormData> {
    // fetch mocks in these tests receive the real FormData instance built
    // by the module -- no re-parsing needed, just cast.
    return body as FormData;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("elevenLabsTranscribe -- request shape", () => {
    it("posts to /speech-to-text with xi-api-key and no Authorization header", async () => {
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ text: "hello" }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        await elevenLabsTranscribe({
            apiKey: "sk_test",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
        expect(init.method).toBe("POST");
        expect(init.headers["xi-api-key"]).toBe("sk_test");
        expect(init.headers.Authorization).toBeUndefined();
        expect(init.headers.authorization).toBeUndefined();
    });

    it("strips a trailing slash from a custom base URL", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ text: "hi" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            baseUrl: "https://proxy.example.com/v1/",
            diarize: false,
            timeoutMs: 5000,
        });

        const [url] = fetchSpy.mock.calls[0];
        expect(url).toBe("https://proxy.example.com/v1/speech-to-text");
    });

    it("includes model_id, diarize, and timestamps_granularity in the form", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ text: "hi" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            timeoutMs: 5000,
        });

        const [, init] = fetchSpy.mock.calls[0];
        const form = await readForm(init.body);
        expect(form.get("model_id")).toBe("scribe_v2");
        expect(form.get("diarize")).toBe("true");
        expect(form.get("timestamps_granularity")).toBe("word");
        expect(form.get("tag_audio_events")).toBe("false");
    });

    it("omits language_code for auto-detect and includes it when set", async () => {
        const fetchSpy = vi.fn().mockImplementation(
            async () =>
                new Response(JSON.stringify({ text: "hi" }), {
                    status: 200,
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        const formAuto = await readForm(fetchSpy.mock.calls[0][1].body);
        expect(formAuto.get("language_code")).toBeNull();

        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            language: "de",
            diarize: false,
            timeoutMs: 5000,
        });
        const formDe = await readForm(fetchSpy.mock.calls[1][1].body);
        expect(formDe.get("language_code")).toBe("de");
    });

    it("includes num_speakers only when diarize is on and the hint is in range", async () => {
        const fetchSpy = vi.fn().mockImplementation(
            async () =>
                new Response(JSON.stringify({ text: "hi" }), {
                    status: 200,
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        // diarize off -- hint dropped even though valid.
        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            numSpeakers: 3,
            timeoutMs: 5000,
        });
        expect(
            (await readForm(fetchSpy.mock.calls[0][1].body)).get(
                "num_speakers",
            ),
        ).toBeNull();

        // diarize on, valid hint.
        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            numSpeakers: 4,
            timeoutMs: 5000,
        });
        expect(
            (await readForm(fetchSpy.mock.calls[1][1].body)).get(
                "num_speakers",
            ),
        ).toBe("4");

        // diarize on, out-of-range hint dropped.
        await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            numSpeakers: 33,
            timeoutMs: 5000,
        });
        expect(
            (await readForm(fetchSpy.mock.calls[2][1].body)).get(
                "num_speakers",
            ),
        ).toBeNull();
    });
});

describe("elevenLabsTranscribe -- diarized formatting", () => {
    it("groups contiguous same-speaker words into 'Speaker N:' lines in order of first appearance", async () => {
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    language_code: "en",
                    words: [
                        {
                            text: "Hello",
                            type: "word",
                            speaker_id: "speaker_1",
                        },
                        { text: " ", type: "spacing", speaker_id: "speaker_1" },
                        {
                            text: "there",
                            type: "word",
                            speaker_id: "speaker_1",
                        },
                        { text: "Hi", type: "word", speaker_id: "speaker_0" },
                    ],
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            timeoutMs: 5000,
        });

        // speaker_1 appears first in word order -> Speaker 1.
        expect(result.text).toBe("Speaker 1: Hello there\nSpeaker 2: Hi");
        expect(result.speakerCount).toBe(2);
    });

    it("skips audio_event entries", async () => {
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    words: [
                        { text: "Hi", type: "word", speaker_id: "speaker_0" },
                        {
                            text: "[laughter]",
                            type: "audio_event",
                            speaker_id: "speaker_0",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            timeoutMs: 5000,
        });

        expect(result.text).toBe("Speaker 1: Hi");
    });

    it("falls back to plain text when words carry no speaker_id", async () => {
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "plain fallback",
                    words: [{ text: "plain", type: "word" }],
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: true,
            timeoutMs: 5000,
        });

        expect(result.text).toBe("plain");
        expect(result.speakerCount).toBe(0);
    });

    it("uses the plain text field (not words) when diarize is off", async () => {
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "plain transcript",
                    words: [
                        { text: "Hi", type: "word", speaker_id: "speaker_0" },
                    ],
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        expect(result.text).toBe("plain transcript");
        expect(result.speakerCount).toBe(0);
    });

    it("throws on an empty transcript", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ text: "" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        await expect(
            elevenLabsTranscribe({
                apiKey: "k",
                model: "scribe_v2",
                file: fakeFile(),
                diarize: false,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/empty transcription/i);
    });
});

describe("elevenLabsTranscribe -- language normalization", () => {
    it("normalizes ISO 639-3 'deu' to 'de'", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(
                    JSON.stringify({ text: "hallo", language_code: "deu" }),
                    { status: 200 },
                ),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        expect(result.detectedLanguage).toBe("de");
    });

    it("passes through an unknown code lowercased", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(
                    JSON.stringify({ text: "x", language_code: "XX" }),
                    { status: 200 },
                ),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        expect(result.detectedLanguage).toBe("xx");
    });

    it("returns null when the response has no language_code", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ text: "x" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = await elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        expect(result.detectedLanguage).toBeNull();
    });
});

describe("elevenLabsTranscribe -- errors and retries", () => {
    it("maps 401 to a clear message without leaking the response body", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(
                new Response("internal diagnostic detail", { status: 401 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const promise = elevenLabsTranscribe({
            apiKey: "bad-key",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        await expect(promise).rejects.toBeInstanceOf(ElevenLabsTranscribeError);
        await expect(promise).rejects.toThrow(/rejected the API key/i);
        await expect(promise).rejects.not.toThrow(/internal diagnostic/i);
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it("maps 422 to an invalid-parameters message", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(new Response("bad params", { status: 422 }));
        vi.stubGlobal("fetch", fetchSpy);

        await expect(
            elevenLabsTranscribe({
                apiKey: "k",
                model: "scribe_v2",
                file: fakeFile(),
                diarize: false,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/invalid parameters/i);
    });

    it("does not retry a non-transient 400", async () => {
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(new Response("bad request", { status: 400 }));
        vi.stubGlobal("fetch", fetchSpy);

        await expect(
            elevenLabsTranscribe({
                apiKey: "k",
                model: "scribe_v2",
                file: fakeFile(),
                diarize: false,
                timeoutMs: 5000,
            }),
        ).rejects.toThrow(/400/);
        expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it("retries a 429 and succeeds on the second attempt", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        await vi.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ text: "ok" });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("gives up after exhausting retries on a persistent transient error", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi
            .fn()
            .mockResolvedValue(new Response("upstream down", { status: 503 }));
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        const assertion = expect(result).rejects.toThrow(/503/);
        await vi.runAllTimersAsync();
        await assertion;

        // Initial attempt + 2 retries.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("honors the retry-after header (capped) instead of the exponential backoff", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(
                new Response("slow down", {
                    status: 429,
                    headers: { "retry-after": "5" },
                }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        await vi.advanceTimersByTimeAsync(4999);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        await expect(result).resolves.toMatchObject({ text: "ok" });
    });

    it("uses exponential backoff delays when retry-after is absent", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(new Response("down", { status: 503 }))
            .mockResolvedValueOnce(new Response("down", { status: 503 }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });

        // First retry delay: INITIAL_RETRY_DELAY_MS * 2**0 = 1000ms.
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        // Second retry delay: INITIAL_RETRY_DELAY_MS * 2**1 = 2000ms.
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        await expect(result).resolves.toMatchObject({ text: "ok" });
    });

    it("retries after a fetch rejection (network interruption)", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi
            .fn()
            .mockRejectedValueOnce(new Error("network reset"))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        await vi.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ text: "ok" });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("retries after a per-attempt timeout and eventually times out for good if it never recovers", async () => {
        vi.useFakeTimers();
        let call = 0;
        const fetchSpy = vi.fn().mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise<Response>((resolve, reject) => {
                    call += 1;
                    if (call === 1) {
                        init.signal.addEventListener("abort", () => {
                            const err = new Error("Aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                        return;
                    }
                    resolve(
                        new Response(JSON.stringify({ text: "ok" }), {
                            status: 200,
                        }),
                    );
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        await vi.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ text: "ok" });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("gives up with a 504 after every attempt times out", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi.fn().mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal.addEventListener("abort", () => {
                        const err = new Error("Aborted");
                        err.name = "AbortError";
                        reject(err);
                    });
                }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        const result = elevenLabsTranscribe({
            apiKey: "k",
            model: "scribe_v2",
            file: fakeFile(),
            diarize: false,
            timeoutMs: 5000,
        });
        const assertion = expect(result).rejects.toThrow(/timed out/i);
        await vi.runAllTimersAsync();
        await assertion;

        // Initial attempt + 2 retries.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
});

describe("elevenLabsTranscribe -- file size guard", () => {
    it("rejects a file over the size limit before making a request", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        const bigFile = {
            size: 2 * 1024 * 1024 * 1024,
        } as unknown as File;

        await expect(
            elevenLabsTranscribe({
                apiKey: "k",
                model: "scribe_v2",
                file: bigFile,
                diarize: false,
                timeoutMs: 5000,
            }),
        ).rejects.toBeInstanceOf(ElevenLabsFileTooLargeError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
