import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
    audioCreate: vi.fn(),
    chatCreate: vi.fn(),
}));

// Mock env so transitive imports of Plaud modules (via the sync code
// path under test) don't trip DATABASE_URL/ENCRYPTION_KEY runtime checks.
const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({
        user: { id: "user-79" },
    }),
}));

vi.mock("@/lib/encryption", () => ({
    decrypt: vi.fn().mockReturnValue("fake-api-key"),
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("openai", () => {
    // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
    const MockOpenAI = vi.fn(function () {
        return {
            audio: {
                transcriptions: {
                    create: openAiMocks.audioCreate,
                },
            },
            chat: {
                completions: {
                    create: openAiMocks.chatCreate,
                },
            },
        };
    });
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// verbose_json providers now go through streamTranscribe (SSE) for
// real per-segment progress. Stub here so the existing transcribe
// flow tests don't need to mock a fetch byte stream.
vi.mock("@/lib/transcription/stream-transcribe", () => ({
    streamTranscribe: vi.fn().mockResolvedValue({
        text: "Manual transcript",
        detectedLanguage: "en",
        finalProgressSeconds: 0,
    }),
}));

import {
    DELETE as deleteSummary,
    POST as generateSummary,
    GET as getSummary,
} from "@/app/api/recordings/[id]/summary/route";
import { POST as transcribeRecordingRoute } from "@/app/api/recordings/[id]/transcribe/route";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { ErrorCode } from "@/lib/errors";

const userId = "user-79";
const recordingId = "rec-79";

function routeRequest(path: string, init?: RequestInit) {
    return new Request(`http://localhost${path}`, init);
}

function routeParams() {
    return { params: Promise.resolve({ id: recordingId }) };
}

function exprReferencesColumn(
    expr: unknown,
    col: unknown,
    seen = new Set<unknown>(),
): boolean {
    if (expr == null || typeof expr !== "object") return false;
    if (expr === col) return true;
    if (seen.has(expr)) return false;
    seen.add(expr);

    for (const key of [
        "queryChunks",
        "sql",
        "left",
        "right",
        "value",
        "args",
        "chunks",
        "expr",
    ]) {
        const value = (expr as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
            if (value.some((item) => exprReferencesColumn(item, col, seen))) {
                return true;
            }
        } else if (exprReferencesColumn(value, col, seen)) {
            return true;
        }
    }

    return false;
}

function selectRows(rows: unknown[], captureWhere?: (expr: unknown) => void) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn((expr: unknown) => {
                captureWhere?.(expr);
                return {
                    limit: vi.fn().mockResolvedValue(rows),
                };
            }),
        }),
    };
}

function lockedRecordingRows(rows: unknown[]) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(rows),
                }),
            }),
        }),
    };
}

describe("Issue #79 - v1 incremental update timestamps", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: userId },
        });
        openAiMocks.audioCreate.mockResolvedValue({
            text: "Manual transcript",
            language: "en",
        });
        openAiMocks.chatCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            summary: "Summary",
                            keyPoints: ["One"],
                            actionItems: [],
                        }),
                    },
                },
            ],
        });
        // Satisfy the in-flight-claim + release `db.update(...)` calls in
        // `transcribeRecording`. `.where(...)` is thenable AND exposes
        // `.returning()` so claim (awaits `.returning()`) and release
        // (awaits `.where()` directly) share one mock.
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: recordingId }]),
                    // biome-ignore lint/suspicious/noThenProperty: thenable mock — drizzle chain is awaited in some call sites, returning() is used in others, single mock covers both
                    then: (
                        onFulfilled?: (value: undefined) => unknown,
                        onRejected?: (reason: unknown) => unknown,
                    ) =>
                        Promise.resolve(undefined).then(
                            onFulfilled,
                            onRejected,
                        ),
                }),
            }),
        });
    });

    it("bumps recording updatedAt inside the manual transcription transaction", async () => {
        // The manual route now delegates to the shared `transcribeRecording`
        // worker (issue #101 consolidation), so the select chain is:
        //   1. recording lookup
        //   2. existing transcription (none — manual re-transcribe path)
        //   3. credentials (default transcription provider)
        //   4. user settings
        (db.select as Mock)
            .mockReturnValueOnce(
                selectRows([
                    {
                        id: recordingId,
                        userId,
                        filename: "Manual Recording",
                        storagePath: "recording.mp3",
                        deletedAt: null,
                    },
                ]),
            )
            .mockReturnValueOnce(selectRows([]))
            .mockReturnValueOnce(
                selectRows([
                    {
                        id: "creds-1",
                        provider: "openai",
                        apiKey: "encrypted-key",
                        baseUrl: null,
                        defaultModel: "whisper-1",
                    },
                ]),
            )
            .mockReturnValueOnce(
                selectRows([
                    {
                        autoGenerateTitle: false,
                        syncTitleToPlaud: false,
                        transcriptionQuality: "balanced",
                        defaultTranscriptionLanguage: null,
                    },
                ]),
            );

        const txInsertValues = vi.fn().mockResolvedValue(undefined);
        const recordingBumpSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        const tx = {
            select: vi
                .fn()
                .mockReturnValueOnce(lockedRecordingRows([{ deletedAt: null }]))
                .mockReturnValueOnce(selectRows([])),
            insert: vi.fn().mockReturnValue({ values: txInsertValues }),
            update: vi.fn().mockReturnValue({ set: recordingBumpSet }),
        };
        (db.transaction as Mock).mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown> | unknown,
            ) => callback(tx),
        );

        const response = await transcribeRecordingRoute(
            routeRequest(`/api/recordings/${recordingId}/transcribe`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(tx.update).toHaveBeenCalledWith(recordings);
        expect(recordingBumpSet).toHaveBeenCalledWith({
            updatedAt: expect.any(Date),
        });
    });

    it("scopes summary transcription lookup by user and bumps updatedAt on create", async () => {
        let transcriptionWhere: unknown;
        (db.select as Mock)
            .mockReturnValueOnce(
                selectRows([{ id: recordingId, deletedAt: null }]),
            )
            .mockReturnValueOnce(
                selectRows(
                    [
                        {
                            id: "tr-1",
                            userId,
                            recordingId,
                            text: "Transcript",
                        },
                    ],
                    (expr) => {
                        transcriptionWhere = expr;
                    },
                ),
            )
            .mockReturnValueOnce(selectRows([]))
            .mockReturnValueOnce(selectRows([]))
            .mockReturnValueOnce(
                selectRows([
                    {
                        id: "creds-1",
                        provider: "openai",
                        apiKey: "encrypted-key",
                        baseUrl: null,
                        defaultModel: "gpt-4o-mini",
                    },
                ]),
            );

        const txInsertValues = vi.fn().mockResolvedValue(undefined);
        const recordingBumpSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        const tx = {
            select: vi
                .fn()
                .mockReturnValueOnce(lockedRecordingRows([{ deletedAt: null }]))
                .mockReturnValueOnce(selectRows([])),
            insert: vi.fn().mockReturnValue({ values: txInsertValues }),
            update: vi.fn().mockReturnValue({ set: recordingBumpSet }),
        };
        (db.transaction as Mock).mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown> | unknown,
            ) => callback(tx),
        );

        const response = await generateSummary(
            routeRequest(`/api/recordings/${recordingId}/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(
            exprReferencesColumn(transcriptionWhere, transcriptions.userId),
        ).toBe(true);
        expect(txInsertValues).toHaveBeenCalled();
        expect(tx.update).toHaveBeenCalledWith(recordings);
        expect(recordingBumpSet).toHaveBeenCalledWith({
            updatedAt: expect.any(Date),
        });
    });

    it("scopes summary update by user and bumps recording updatedAt", async () => {
        (db.select as Mock)
            .mockReturnValueOnce(
                selectRows([{ id: recordingId, deletedAt: null }]),
            )
            .mockReturnValueOnce(
                selectRows([
                    {
                        id: "tr-1",
                        userId,
                        recordingId,
                        text: "Transcript",
                    },
                ]),
            )
            .mockReturnValueOnce(selectRows([]))
            .mockReturnValueOnce(selectRows([]))
            .mockReturnValueOnce(
                selectRows([
                    {
                        id: "creds-1",
                        provider: "openai",
                        apiKey: "encrypted-key",
                        baseUrl: null,
                        defaultModel: "gpt-4o-mini",
                    },
                ]),
            );

        let enhancementUpdateWhere: unknown;
        const enhancementUpdateSet = vi.fn().mockReturnValue({
            where: vi.fn((expr: unknown) => {
                enhancementUpdateWhere = expr;
                return Promise.resolve();
            }),
        });
        const recordingBumpSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        const tx = {
            select: vi
                .fn()
                .mockReturnValueOnce(lockedRecordingRows([{ deletedAt: null }]))
                .mockReturnValueOnce(selectRows([{ id: "enh-1", userId }])),
            insert: vi.fn(),
            update: vi
                .fn()
                .mockReturnValueOnce({ set: enhancementUpdateSet })
                .mockReturnValueOnce({ set: recordingBumpSet }),
        };
        (db.transaction as Mock).mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown> | unknown,
            ) => callback(tx),
        );

        const response = await generateSummary(
            routeRequest(`/api/recordings/${recordingId}/summary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(tx.update).toHaveBeenCalledWith(aiEnhancements);
        expect(
            exprReferencesColumn(enhancementUpdateWhere, aiEnhancements.userId),
        ).toBe(true);
        expect(tx.update).toHaveBeenCalledWith(recordings);
        expect(recordingBumpSet).toHaveBeenCalledWith({
            updatedAt: expect.any(Date),
        });
    });

    it("bumps recording updatedAt when a summary row is deleted", async () => {
        const recordingBumpSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        const tx = {
            delete: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: "enh-1" }]),
                }),
            }),
            update: vi.fn().mockReturnValue({ set: recordingBumpSet }),
        };
        (db.transaction as Mock).mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown> | unknown,
            ) => callback(tx),
        );

        const response = await deleteSummary(
            routeRequest(`/api/recordings/${recordingId}/summary`, {
                method: "DELETE",
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(tx.update).toHaveBeenCalledWith(recordings);
        expect(recordingBumpSet).toHaveBeenCalledWith({
            updatedAt: expect.any(Date),
        });
    });

    it("does not bump recording updatedAt when no summary row is deleted", async () => {
        const tx = {
            delete: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
            update: vi.fn(),
        };
        (db.transaction as Mock).mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown> | unknown,
            ) => callback(tx),
        );

        const response = await deleteSummary(
            routeRequest(`/api/recordings/${recordingId}/summary`, {
                method: "DELETE",
            }),
            routeParams(),
        );

        expect(response.status).toBe(200);
        expect(tx.update).not.toHaveBeenCalled();
    });

    it("does not return summaries for deleted recordings", async () => {
        (db.select as Mock).mockReturnValueOnce(selectRows([]));

        const response = await getSummary(
            routeRequest(`/api/recordings/${recordingId}/summary`),
            routeParams(),
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            code: ErrorCode.RECORDING_NOT_FOUND,
        });
    });
});
