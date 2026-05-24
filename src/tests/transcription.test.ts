import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
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
    const MockOpenAI = vi.fn(() => ({
        audio: {
            transcriptions: {
                create: vi.fn(),
            },
        },
    }));
    return { OpenAI: MockOpenAI };
});

vi.mock("@/lib/webhooks/emit", () => ({
    emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi
        .fn()
        .mockResolvedValue("Generated Title"),
}));

vi.mock("@/lib/plaud/client-factory", () => ({
    createPlaudClient: vi.fn(),
}));

import { OpenAI } from "openai";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";
import { emitEvent } from "@/lib/webhooks/emit";

describe("Transcription", () => {
    const mockUserId = "user-123";
    const mockRecordingId = "rec-456";

    /**
     * Default `db.update(...)` mock that satisfies the in-flight-claim
     * pattern in `transcribeRecording`:
     *
     *   - claim:   `db.update(recordings).set({transcribingStartedAt}).where(...).returning({id})`
     *   - release: `db.update(recordings).set({transcribingStartedAt: null}).where(...)`
     *   - title:   `db.update(recordings).set({filename, updatedAt}).where(...)`
     *
     * All three share `db.update`, so the chain object below is thenable
     * on `.where(...)` AND exposes a `.returning()` resolver — that way
     * a single mock handles both endings without requiring tests to
     * juggle `mockReturnValueOnce` for each call.
     */
    function buildDefaultDbUpdateMock(): {
        set: Mock;
    } {
        const whereResult = {
            returning: vi.fn().mockResolvedValue([{ id: mockRecordingId }]),
            // biome-ignore lint/suspicious/noThenProperty: thenable mock — drizzle chain is awaited in some call sites, returning() is used in others, single mock covers both
            then: (
                onFulfilled?: (value: undefined) => unknown,
                onRejected?: (reason: unknown) => unknown,
            ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
        };
        return {
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue(whereResult),
            }),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
        (OpenAI as unknown as Mock).mockImplementation(function () {
            return {
                audio: {
                    transcriptions: {
                        create: vi.fn(),
                    },
                },
            };
        });
        (db.update as Mock).mockReturnValue(buildDefaultDbUpdateMock());
    });

    describe("transcribeRecording", () => {
        it("should return error when recording not found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Recording not found");
        });

        it("should return success when transcription already exists", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { id: "trans-1", text: "Existing text" },
                                ]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
        });

        // ─────────────────────────────────────────────────────────────────
        // MISSING REGRESSION TEST — stall-then-takeover claim sequence
        // ─────────────────────────────────────────────────────────────────
        //
        // The release path in `transcribeRecording`'s `finally` matches on
        //   (recording_id, user_id, transcribing_started_at = claimedAt)
        // — the third predicate is the ownership token. Capturing it is
        // load-bearing for the following sequence, which the current
        // suite does NOT cover:
        //
        //   1. Worker A claims at T0 (sets transcribing_started_at = T0).
        //   2. Worker A stalls past TRANSCRIPTION_STALE_TIMEOUT_MS (3h).
        //   3. Worker B comes in, sees stale claim, takes over
        //      (overwrites transcribing_started_at = T1, T1 > T0 + 3h).
        //   4. Worker A finally returns from its stalled `await`, runs
        //      its `finally` clause.
        //   5. Without the ownership token, A's release would clear B's
        //      claim → a hypothetical C would pass the claim check and
        //      start a third parallel run, defeating the whole point of
        //      the atomic claim.
        //
        // The ~3-line fix is straightforward, but a future refactor that
        // moves the `finally` to a helper, reorders the release vs. the
        // webhook-emit, or "simplifies" the WHERE clause back to the
        // (recording_id, user_id) form would silently break this without
        // the mocks in this file ever noticing — they don't observe what
        // predicate the UPDATE is actually filtering on.
        //
        // A real test for this would need either (a) two concurrent
        // transactions against a real postgres, or (b) a mock that
        // records the WHERE-clause args and asserts the `claimedAt`
        // predicate is present. Both feel out of scope here, but if
        // you're touching this file: please add the case rather than
        // leave the gap.
        //
        // Flagged by cubic-dev-ai on PR #175.
        it("returns TRANSCRIPTION_IN_PROGRESS when a fresh claim is already held", async () => {
            // recording lookup → exists
            // existingTranscription lookup → none
            // credentials lookup → present (so we get past the provider check)
            // user settings lookup → present
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                    deletedAt: null,
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: "creds-1",
                                    provider: "openai",
                                    apiKey: "encrypted-key",
                                    defaultModel: "whisper-1",
                                    baseUrl: null,
                                },
                            ]),
                        }),
                    }),
                });

            // Override the default db.update mock so the claim returns
            // zero rows (claim race lost — another worker already holds
            // a fresh claim on this recording).
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("TRANSCRIPTION_IN_PROGRESS");
            // Provider call must NOT have been attempted — the whole
            // point of the claim is to skip the work, not to bill the
            // user for a parallel run. The OpenAI constructor is only
            // reached if we get past the claim, so an unmade construction
            // is the cleanest "no provider call happened" signal.
            expect(OpenAI).not.toHaveBeenCalled();
        });

        it("should return error when no API credentials configured", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("No transcription API configured");
        });

        it("should return error when API call fails", async () => {
            const mockCreate = vi
                .fn()
                .mockRejectedValue(new Error("API Error"));
            // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
            (OpenAI as unknown as Mock).mockImplementation(function () {
                return {
                    audio: { transcriptions: { create: mockCreate } },
                };
            });

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: "creds-1",
                                    provider: "openai",
                                    apiKey: "encrypted-key",
                                    defaultModel: "whisper-1",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([{ id: "settings-1" }]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("API Error");
        });

        it("bumps recording updatedAt and emits completion after generated title is stored", async () => {
            const mockCreate = vi.fn().mockResolvedValue({
                text: "Fresh transcript",
                language: "en",
            });
            // biome-ignore lint/complexity/useArrowFunction: mock must be constructable
            (OpenAI as unknown as Mock).mockImplementation(function () {
                return {
                    audio: { transcriptions: { create: mockCreate } },
                };
            });
            (generateTitleFromTranscription as Mock).mockResolvedValue(
                "Generated Title",
            );

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    userId: mockUserId,
                                    plaudFileId: "plaud-1",
                                    filename: "Original Title",
                                    storagePath: "test.mp3",
                                    deletedAt: null,
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: "creds-1",
                                    provider: "openai",
                                    apiKey: "encrypted-key",
                                    defaultModel: "whisper-1",
                                    baseUrl: null,
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    autoGenerateTitle: true,
                                    syncTitleToPlaud: false,
                                },
                            ]),
                        }),
                    }),
                });

            const txInsertValues = vi.fn().mockResolvedValue(undefined);
            const txInsert = vi.fn().mockReturnValue({
                values: txInsertValues,
            });
            const recordingBumpWhere = vi.fn().mockResolvedValue(undefined);
            const recordingBumpSet = vi.fn().mockReturnValue({
                where: recordingBumpWhere,
            });
            const txUpdate = vi.fn().mockReturnValue({
                set: recordingBumpSet,
            });
            const tx = {
                select: vi
                    .fn()
                    .mockReturnValueOnce({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                for: vi.fn().mockReturnValue({
                                    limit: vi
                                        .fn()
                                        .mockResolvedValue([
                                            { deletedAt: null },
                                        ]),
                                }),
                            }),
                        }),
                    })
                    .mockReturnValueOnce({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([]),
                            }),
                        }),
                    }),
                insert: txInsert,
                update: txUpdate,
            };
            (db.transaction as Mock).mockImplementation(
                async (
                    callback: (
                        transaction: typeof tx,
                    ) => Promise<unknown> | unknown,
                ) => callback(tx),
            );

            // titleUpdateWhere is awaited (no `.returning()`), but the
            // in-flight claim call on the same `db.update` mock DOES
            // call `.returning()`. Make the where result satisfy both
            // shapes so a single `mockReturnValue` covers the claim,
            // the title update, and the release in any order.
            const titleUpdateWhere = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: mockRecordingId }]),
                // biome-ignore lint/suspicious/noThenProperty: thenable mock — drizzle chain is awaited in some call sites, returning() is used in others, single mock covers both
                then: (
                    onFulfilled?: (value: undefined) => unknown,
                    onRejected?: (reason: unknown) => unknown,
                ) => Promise.resolve(undefined).then(onFulfilled, onRejected),
            });
            const titleUpdateSet = vi.fn().mockReturnValue({
                where: titleUpdateWhere,
            });
            (db.update as Mock).mockReturnValue({
                set: titleUpdateSet,
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
            expect(txInsert).toHaveBeenCalled();
            expect(txUpdate).toHaveBeenCalledWith(recordings);
            expect(recordingBumpSet).toHaveBeenCalledWith({
                updatedAt: expect.any(Date),
            });
            expect(titleUpdateSet).toHaveBeenCalledWith({
                filename: "v1:encrypted:Generated Title",
                updatedAt: expect.any(Date),
            });
            expect(emitEvent).toHaveBeenCalledWith(
                "transcription.completed",
                mockUserId,
                mockRecordingId,
            );
            expect(
                (emitEvent as Mock).mock.invocationCallOrder[0],
            ).toBeGreaterThan(titleUpdateWhere.mock.invocationCallOrder[0]);
        });
    });
});
