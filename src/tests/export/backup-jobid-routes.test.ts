import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, envMock, storageMock } = vi.hoisted(() => ({
    queriesMock: { getExportJobForUser: vi.fn() },
    envMock: { DEFAULT_STORAGE_TYPE: "local" as "local" | "s3" },
    storageMock: {
        getSignedUrl: vi.fn(),
        downloadStream: vi.fn(),
    },
}));

vi.mock("@/db/queries/export-jobs", () => queriesMock);
vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/storage/factory", () => ({
    createStorageProvider: () => storageMock,
}));

import { GET as downloadGET } from "@/app/api/backup/[jobId]/download/route";
import { GET as statusGET } from "@/app/api/backup/[jobId]/route";

const HOUR_MS = 60 * 60 * 1000;

function baseJob(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: "job-1",
        userId: "user-1",
        status: "completed",
        storageKey: "exports/user-1/job-1-token.zip",
        fileSize: 1234,
        recordingCount: 3,
        errorMessage: null,
        attempts: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        startedAt: null,
        completedAt: new Date("2026-01-01T00:05:00Z"),
        expiresAt: new Date(Date.now() + HOUR_MS),
        ...overrides,
    };
}

describe("GET /api/backup/[jobId] and .../download (retention window)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.DEFAULT_STORAGE_TYPE = "local";
        storageMock.getSignedUrl.mockResolvedValue(
            "https://example.com/signed",
        );
    });

    it("status route reports a completed-but-past-expiresAt row as 'expired', not 'completed'", async () => {
        queriesMock.getExportJobForUser.mockResolvedValue(
            baseJob({ expiresAt: new Date(Date.now() - HOUR_MS) }),
        );

        const response = await statusGET(
            new Request("https://app.example.com/api/backup/job-1"),
            { params: Promise.resolve({ jobId: "job-1" }) },
        );
        const body = await response.json();

        expect(body.job.status).toBe("expired");
    });

    it("status route still reports 'completed' when not yet expired", async () => {
        queriesMock.getExportJobForUser.mockResolvedValue(baseJob());

        const response = await statusGET(
            new Request("https://app.example.com/api/backup/job-1"),
            { params: Promise.resolve({ jobId: "job-1" }) },
        );
        const body = await response.json();

        expect(body.job.status).toBe("completed");
    });

    it("download route refuses a completed-but-expired row even though storageKey is still set", async () => {
        // Simulates the row surviving past its retention window because
        // the cleanup worker's storage delete is still retrying --
        // status stays "completed" with a live storageKey.
        queriesMock.getExportJobForUser.mockResolvedValue(
            baseJob({ expiresAt: new Date(Date.now() - HOUR_MS) }),
        );

        const response = await downloadGET(
            new Request("https://app.example.com/api/backup/job-1/download"),
            { params: Promise.resolve({ jobId: "job-1" }) },
        );

        expect(response.status).toBe(404);
        expect(storageMock.getSignedUrl).not.toHaveBeenCalled();
        expect(storageMock.downloadStream).not.toHaveBeenCalled();
    });

    it("download route serves a not-yet-expired completed archive", async () => {
        envMock.DEFAULT_STORAGE_TYPE = "s3";
        queriesMock.getExportJobForUser.mockResolvedValue(baseJob());

        const response = await downloadGET(
            new Request("https://app.example.com/api/backup/job-1/download"),
            { params: Promise.resolve({ jobId: "job-1" }) },
        );

        expect(response.status).toBe(307);
        expect(storageMock.getSignedUrl).toHaveBeenCalledWith(
            "exports/user-1/job-1-token.zip",
            expect.any(Number),
        );
    });
});
