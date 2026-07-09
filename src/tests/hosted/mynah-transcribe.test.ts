import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reserveMock, releaseMock, commitMock, storageMock, envMock } =
    vi.hoisted(() => ({
        reserveMock: vi.fn(),
        releaseMock: vi.fn(),
        commitMock: vi.fn(),
        storageMock: { getSignedUrl: vi.fn() },
        envMock: {
            IS_HOSTED: true,
            MYNAH_BASE_URL: "https://mynah.test",
            MYNAH_SERVICE_TOKEN: "secret",
        },
    }));

vi.mock("@/lib/hosted/billing/enforcement", () => ({
    reserveMynah: reserveMock,
    releaseMynahReservation: releaseMock,
    commitMynahReservation: commitMock,
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue(storageMock),
}));

import {
    isMynahConfigured,
    MynahBudgetExhaustedError,
    transcribeViaMynah,
} from "@/lib/hosted/transcription/mynah";

const input = {
    userId: "u1",
    storagePath: "u1/rec.mp3",
    durationMs: 65_000,
    language: "en",
};

beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getSignedUrl.mockResolvedValue("https://signed.test/rec");
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("isMynahConfigured", () => {
    it("true when hosted with a token", () => {
        expect(isMynahConfigured()).toBe(true);
    });
});

describe("transcribeViaMynah", () => {
    it("reserves ceil(seconds), commits on success, returns parsed text", async () => {
        reserveMock.mockResolvedValue({
            userId: "u1",
            seconds: 65,
            reserved: true,
        });
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ text: "hello", language: "en" }),
                        { status: 200 },
                    ),
                ),
        );

        const result = await transcribeViaMynah(input);

        expect(reserveMock).toHaveBeenCalledWith({ userId: "u1", seconds: 65 });
        expect(commitMock).toHaveBeenCalledOnce();
        expect(releaseMock).not.toHaveBeenCalled();
        expect(result).toEqual({ text: "hello", detectedLanguage: "en" });
    });

    it("sends a JSON url body when the signed URL is absolute (S3)", async () => {
        reserveMock.mockResolvedValue({
            userId: "u1",
            seconds: 65,
            reserved: true,
        });
        const fetchSpy = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ text: "hi", language: "en" }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetchSpy);

        await transcribeViaMynah(input);

        const [, init] = fetchSpy.mock.calls[0];
        expect(init.headers["content-type"]).toBe("application/json");
        expect(JSON.parse(init.body)).toMatchObject({
            url: "https://signed.test/rec",
            response_format: "verbose_json",
        });
        expect(storageMock.getSignedUrl).toHaveBeenCalled();
    });

    it("fails clearly and refunds when the signed URL is not fetchable (local)", async () => {
        storageMock.getSignedUrl.mockResolvedValue(
            "/api/recordings/audio/u1%2Frec.mp3",
        );
        reserveMock.mockResolvedValue({
            userId: "u1",
            seconds: 65,
            reserved: true,
        });
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        await expect(transcribeViaMynah(input)).rejects.toThrow(
            /object storage/i,
        );
        // Never hits Mynah, and the reservation is refunded.
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(releaseMock).toHaveBeenCalledOnce();
        expect(commitMock).not.toHaveBeenCalled();
    });

    it("throws budget error and never calls fetch when reservation fails", async () => {
        reserveMock.mockResolvedValue({
            userId: "u1",
            seconds: 65,
            reserved: false,
        });
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        await expect(transcribeViaMynah(input)).rejects.toBeInstanceOf(
            MynahBudgetExhaustedError,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refunds the reservation when Mynah returns an error", async () => {
        reserveMock.mockResolvedValue({
            userId: "u1",
            seconds: 65,
            reserved: true,
        });
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response("upstream down", { status: 502 }),
                ),
        );

        await expect(transcribeViaMynah(input)).rejects.toThrow(/502/);
        expect(releaseMock).toHaveBeenCalledOnce();
        expect(commitMock).not.toHaveBeenCalled();
    });
});
