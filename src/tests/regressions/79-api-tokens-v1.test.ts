import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

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

import { POST as createToken } from "@/app/api/settings/tokens/route";
import { GET as listV1Recordings } from "@/app/api/v1/recordings/route";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";

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

describe("Issue #79 — API tokens and v1 recordings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-79" },
        });
    });

    it("creates a token once, accepts it on v1 routes, and scopes recordings by userId", async () => {
        let insertedHash = "";
        (db.insert as Mock).mockReturnValue({
            values: vi.fn((values: { tokenHash: string }) => {
                insertedHash = values.tokenHash;
                return {
                    returning: vi.fn().mockResolvedValue([
                        {
                            id: "pat-1",
                            userId: "user-79",
                            name: "Hermes",
                            tokenHash: values.tokenHash,
                            tokenPrefix: "opp_abcdef12",
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

        const createResponse = await createToken(
            routeRequest("http://localhost/api/settings/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Hermes" }),
            }),
        );

        expect(createResponse.status).toBe(201);
        const created = (await createResponse.json()) as { token: string };
        expect(created.token).toMatch(/^opp_/);

        (auth.api.getSession as unknown as Mock).mockResolvedValue(null);
        (db.update as Mock).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        });

        const authSelectChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            id: "pat-1",
                            userId: "user-79",
                            name: "Hermes",
                            tokenHash: insertedHash,
                            tokenPrefix: "opp_abcdef12",
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
            .mockReturnValueOnce({
                from: vi.fn().mockReturnValue(listChain),
            });

        const listResponse = await listV1Recordings(
            routeRequest("http://localhost/api/v1/recordings?limit=1", {
                headers: { Authorization: `Bearer ${created.token}` },
            }),
        );

        expect(listResponse.status).toBe(200);
        const listBody = (await listResponse.json()) as {
            data: Array<{ id: string }>;
        };
        expect(listBody.data.map((recording) => recording.id)).toEqual([
            "rec-1",
        ]);
        expect(exprReferencesColumn(whereExpr, recordings.userId)).toBe(true);
    });
});
