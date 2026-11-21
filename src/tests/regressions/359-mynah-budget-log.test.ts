/**
 * Regression for #359 logging. A used-up Mynah budget is an expected
 * account state, so it logs one info line without a stack trace. Every
 * other transcription failure keeps its error log.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string) => value),
    encryptText: vi.fn((value: string) => `enc:${value}`),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/entitlements", () => ({
    isHostedLockedOut: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
    env: {
        WHISPER_REQUEST_TIMEOUT_MS: 60 * 60 * 1000,
    },
}));

vi.mock("@/lib/hosted/transcription/mynah", () => ({
    isMynahConfigured: vi.fn().mockReturnValue(true),
    transcribeViaMynah: vi.fn(),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({}),
}));

import { db } from "@/db";
import { transcribeViaMynah } from "@/lib/hosted/transcription/mynah";
import { RIFFADO_INCLUDED_PROVIDER_ID } from "@/lib/transcription/included-provider";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

const USER_ID = "user-359-log";

function installSelectStub() {
    const row = {
        id: "row-1",
        userId: USER_ID,
        plaudFileId: "plaud-1",
        filename: "Some Recording",
        storagePath: "rec.mp3",
        duration: 60_000,
        deletedAt: null,
        text: null,
        defaultTranscriptionProviderId: RIFFADO_INCLUDED_PROVIDER_ID,
    };
    (db.select as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([row]),
            }),
        }),
    });
}

describe("#359 Mynah budget exhaustion logging", () => {
    let info: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        installSelectStub();
        info = vi.spyOn(console, "info").mockImplementation(() => {});
        error = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("logs one info line without a stack and no error", async () => {
        const exhausted = new Error(
            "Mynah transcription budget exhausted for this cycle",
        );
        exhausted.name = "MynahBudgetExhaustedError";
        (transcribeViaMynah as Mock).mockRejectedValue(exhausted);

        const result = await transcribeRecording(USER_ID, "rec-1", {
            trigger: "sync",
        });

        expect(result.errorCode).toBe("MYNAH_BUDGET_EXHAUSTED");
        expect(error).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledTimes(1);
        expect(info.mock.calls[0]).toHaveLength(1);
        expect(typeof info.mock.calls[0]?.[0]).toBe("string");
    });

    it("keeps the error log for other failures", async () => {
        (transcribeViaMynah as Mock).mockRejectedValue(new Error("boom"));

        const result = await transcribeRecording(USER_ID, "rec-2", {
            trigger: "sync",
        });

        expect(result.errorCode).toBe("TRANSCRIPTION_FAILED");
        expect(error).toHaveBeenCalledTimes(1);
        expect(info).not.toHaveBeenCalled();
    });
});
