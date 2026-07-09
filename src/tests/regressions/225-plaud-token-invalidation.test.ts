/**
 * Regression: #225 — when Plaud rejects the stored token (HTTP 401 ->
 * PLAUD_INVALID_TOKEN) during a sync, the connection must be flagged as
 * needing reconnect (persisted `invalidatedAt`) and the sync result must
 * carry `needsReconnect: true`, instead of the old behavior where the 401
 * was swallowed into a generic "Sync failed" string with no signal.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

function mockConnectionSelects() {
    const mockConnection = {
        id: "conn-1",
        userId: "user-225",
        bearerToken: "encrypted-token",
    };
    (db.select as Mock)
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([mockConnection]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: "settings-1" }]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi
                        .fn()
                        .mockResolvedValue([{ email: "test@example.com" }]),
                }),
            }),
        });
}

describe("#225 Plaud token invalidation on 401", () => {
    const mockUserId = "user-225";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("flags needsReconnect and stamps invalidatedAt on PLAUD_INVALID_TOKEN", async () => {
        mockConnectionSelects();

        const setSpy = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({ set: setSpy });

        const mockPlaudClient = {
            getRecordings: vi
                .fn()
                .mockRejectedValue(
                    new AppError(
                        ErrorCode.PLAUD_INVALID_TOKEN,
                        "Plaud rejected the access token.",
                        401,
                    ),
                ),
            downloadRecording: vi.fn(),
            workspaceId: null,
        };
        (createPlaudClient as Mock).mockResolvedValue(mockPlaudClient);

        const result = await syncRecordingsForUser(mockUserId);

        expect(result.needsReconnect).toBe(true);
        // Connection was stamped invalid.
        expect(setSpy).toHaveBeenCalledWith(
            expect.objectContaining({ invalidatedAt: expect.any(Date) }),
        );
        // Old generic "Sync failed" string is not the surfaced error.
        expect(result.errors.some((e) => /reconnect/i.test(e))).toBe(true);
        expect(result.errors.some((e) => e.startsWith("Sync failed"))).toBe(
            false,
        );
    });

    it("does not flag needsReconnect on a non-auth failure", async () => {
        mockConnectionSelects();

        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });

        (createPlaudClient as Mock).mockRejectedValue(
            new Error("network down"),
        );

        const result = await syncRecordingsForUser(mockUserId);

        expect(result.needsReconnect).toBeFalsy();
        expect(result.errors.some((e) => e.startsWith("Sync failed"))).toBe(
            true,
        );
    });
});
