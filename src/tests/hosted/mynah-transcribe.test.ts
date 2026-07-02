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
