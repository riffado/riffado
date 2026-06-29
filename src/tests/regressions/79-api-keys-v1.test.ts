import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
        API_TOKEN_HASH_SECRET: undefined,
    },
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
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

vi.mock("@/lib/v1/rate-limit", () => ({
    enforceV1IpRateLimit: vi.fn().mockResolvedValue(null),
    enforceV1AuthenticatedRateLimit: vi.fn().mockResolvedValue(null),
}));

import { POST as createApiKey } from "@/app/api/settings/api-keys/route";
import { GET as listV1Recordings } from "@/app/api/v1/recordings/route";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, ErrorCode } from "@/lib/errors";

const now = new Date("2026-05-06T12:00:00.000Z");

function routeRequest(url: string, init?: RequestInit) {
    return new Request(url, init);
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

describe("Issue #79 - API keys and v1 recordings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (requireApiSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-79" },
        });
        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-79" },
        });
    });

    it("refuses API key creation for suspended users", async () => {
        (requireApiSession as unknown as Mock).mockRejectedValueOnce(
            new AppError(ErrorCode.ACCOUNT_SUSPENDED, "Account suspended", 403),
        );

        const response = await createApiKey(
            routeRequest("http://localhost/api/settings/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Hermes" }),
            }),
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            code: ErrorCode.ACCOUNT_SUSPENDED,
        });
        expect(db.insert).not.toHaveBeenCalled();
    });

    it("creates a key once, accepts it on v1 routes, and scopes recordings by userId", async () => {
        let insertedHash = "";
        (db.insert as Mock).mockReturnValue({
            values: vi.fn((values: { keyHash: string; source: string }) => {
                insertedHash = values.keyHash;
                expect(values.source).toBe("manual");
                return {
                    returning: vi.fn().mockResolvedValue([
                        {
                            id: "api-key-1",
                            userId: "user-79",
                            name: "Hermes",
                            keyHash: values.keyHash,
                            keyPrefix: "op_abcdef12",
                            source: "manual",
                            scopes: ["read"],
                            lastUsedAt: null,
                            expiresAt: null,
                            revokedAt: null,
                            createdAt: now,
                            updatedAt: now,
                        },
                    ]),
                };
            }),
        });

        const createResponse = await createApiKey(
            routeRequest("http://localhost/api/settings/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Hermes" }),
            }),
        );

        expect(createResponse.status).toBe(201);
        const created = (await createResponse.json()) as {
            key: string;
            apiKey: { keyPrefix: string; source: string };
        };
        expect(created.key).toMatch(/^op_/);
        expect(created.apiKey).toMatchObject({
            keyPrefix: "op_abcdef12",
            source: "manual",
        });

        (auth.api.getSession as unknown as Mock).mockResolvedValue(null);
        const updateSet = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });
        (db.update as Mock).mockReturnValue({
            set: updateSet,
        });

        const authSelectChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            id: "api-key-1",
                            userId: "user-79",
                            name: "Hermes",
                            keyHash: insertedHash,
                            keyPrefix: "op_abcdef12",
                            source: "manual",
                            scopes: ["read"],
                            lastUsedAt: null,
                            expiresAt: null,
                            revokedAt: null,
                            createdAt: now,
                            updatedAt: now,
                        },
                    ]),
                }),
            }),
        };
        const userSelectChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ suspendedAt: null }]),
                }),
            }),
        };

        let whereExpr: unknown;
        const listChain = {
            leftJoin: vi.fn(),
            where: vi.fn((expr: unknown) => {
                whereExpr = expr;
                return {
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                recording: {
                                    id: "rec-1",
                                    userId: "user-79",
                                    deviceSn: "SN-1",
                                    plaudFileId: "plaud-1",
                                    filename: "Scoped Recording",
                                    duration: 1000,
                                    startTime: now,
                                    endTime: now,
                                    filesize: 100,
                                    fileMd5: "md5",
                                    storageType: "local",
                                    storagePath: "user-79/rec.mp3",
                                    downloadedAt: now,
                                    plaudVersion: "1",
                                    timezone: null,
                                    zonemins: null,
                                    scene: null,
                                    isTrash: false,
                                    deletedAt: null,
                                    createdAt: now,
                                    updatedAt: now,
                                },
                                device: null,
                                transcription: null,
                                enhancement: null,
                            },
                        ]),
                    }),
                };
            }),
        };
        listChain.leftJoin.mockReturnValue(listChain);

        (db.select as Mock)
            .mockReturnValueOnce(authSelectChain)
            .mockReturnValueOnce(userSelectChain)
            // has_transcription is now computed via a correlated EXISTS
            // subquery (transcripts are 1:N per recording), which issues its
            // own db.select() before the main list query.
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({}),
                }),
            })
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue(listChain),
            });

        const listResponse = await listV1Recordings(
            routeRequest("http://localhost/api/v1/recordings?limit=1", {
                headers: { Authorization: `Bearer ${created.key}` },
            }),
        );

        expect(listResponse.status).toBe(200);
        const listBody = (await listResponse.json()) as {
            data: Array<{ id: string }>;
        };
        expect(listBody.data.map((recording) => recording.id)).toEqual([
            "rec-1",
        ]);
        expect(updateSet).toHaveBeenCalledWith(
            expect.objectContaining({
                lastUsedAt: expect.any(Date) as Date,
                updatedAt: expect.any(Date) as Date,
            }),
        );
        expect(exprReferencesColumn(whereExpr, recordings.userId)).toBe(true);
    });
});
