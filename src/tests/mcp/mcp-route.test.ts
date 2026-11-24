import type { CallToolResult } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
        API_TOKEN_HASH_SECRET: undefined,
    },
}));

vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
    captureServerEvent: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/v1/rate-limit", () => ({
    enforceV1IpRateLimit: vi.fn(),
    enforceV1AuthenticatedRateLimit: vi.fn(),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: vi.fn((value: string | null | undefined) =>
        typeof value === "string" ? value.replace(/^encrypted:/, "") : value,
    ),
    decryptJsonField: vi.fn((value: unknown) => value ?? null),
}));

import { DELETE, GET, POST } from "@/app/api/v1/mcp/route";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { createApiKey, hashApiKey } from "@/lib/auth-request";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";
import { createFakeDb, type FakeTables } from "./fake-db";

const now = new Date("2026-05-06T12:00:00.000Z");
const KEY_A = createApiKey();
const KEY_B = createApiKey();

function recording(id: string, userId: string, title: string, minute: number) {
    const time = new Date(now.getTime() - minute * 60_000);
    return {
        id,
        userId,
        deviceSn: "SN-1",
        plaudFileId: `plaud-${id}`,
        filename: `encrypted:${title}`,
        duration: 120000,
        startTime: time,
        endTime: time,
        filesize: 1000,
        fileMd5: "abc",
        storageType: "local",
        storagePath: `${userId}/${id}.mp3`,
        downloadedAt: now,
        plaudVersion: "1",
        timezone: null,
        zonemins: null,
        scene: null,
        isTrash: false,
        waveformPeaks: null,
        deletedAt: null as Date | null,
        createdAt: time,
        updatedAt: time,
    };
}

function transcript(recordingId: string, userId: string, text: string) {
    return {
        id: `tr-${recordingId}`,
        recordingId,
        userId,
        text: `encrypted:${text}`,
        detectedLanguage: "en",
        transcriptionType: "server",
        provider: "openai",
        model: "whisper-1",
        source: "riffado",
        createdAt: now,
    };
}

function apiKey(id: string, userId: string, key: string) {
    return {
        id,
        userId,
        name: id,
        keyHash: hashApiKey(key),
        keyPrefix: key.slice(0, 12),
        source: "manual",
        scopes: ["read"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
    };
}

function seed(): FakeTables {
    const deleted = recording("a-deleted", "user-a", "Deleted budget", 1);
    deleted.deletedAt = now;
    return {
        users: [
            { id: "user-a", suspendedAt: null },
            { id: "user-b", suspendedAt: null },
        ],
        api_keys: [
            apiKey("key-a", "user-a", KEY_A),
            apiKey("key-b", "user-b", KEY_B),
        ],
        recordings: [
            deleted,
            recording("a-1", "user-a", "Budget review", 2),
            recording("b-1", "user-b", "Budget secrets", 3),
            recording("a-2", "user-a", "Weekly sync", 4),
            recording("a-3", "user-a", "Design chat", 5),
        ],
        transcriptions: [
            transcript("a-deleted", "user-a", "the quarterly budget"),
            transcript("a-1", "user-a", "We went over numbers."),
            transcript(
                "b-1",
                "user-b",
                "Private quarterly budget numbers for user b.",
            ),
            transcript(
                "a-2",
                "user-a",
                `${"Intro chatter. ".repeat(20)}Then the Quarterly Budget came up again.${" More talk.".repeat(20)}`,
            ),
            transcript("a-3", "user-a", "The quarterly budget is final."),
        ],
        ai_enhancements: [
            {
                id: "sum-b-1",
                recordingId: "b-1",
                userId: "user-b",
                summary: "encrypted:User b summary",
                actionItems: ["Secret"],
                keyPoints: ["Secret"],
                provider: "openai",
                model: "gpt-4o-mini",
                source: "riffado",
                createdAt: now,
            },
            {
                id: "sum-a-1",
                recordingId: "a-1",
                userId: "user-a",
                summary: "encrypted:Budget was approved",
                actionItems: ["Send report"],
                keyPoints: ["Approved"],
                provider: "openai",
                model: "gpt-4o-mini",
                source: "riffado",
                createdAt: now,
            },
        ],
        plaud_devices: [],
        user_settings: [],
    };
}

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/v1/mcp", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

async function readJsonRpc(response: Response): Promise<{
    result?: unknown;
    error?: unknown;
}> {
    const text = await response.text();
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const data = text.split("\n").find((line) => line.startsWith("data: "));
        return JSON.parse(data?.slice("data: ".length) ?? "{}");
    }
    return JSON.parse(text);
}

async function callTool(
    name: string,
    args: Record<string, unknown>,
    key = KEY_A,
): Promise<CallToolResult> {
    const response = await POST(
        mcpRequest(
            {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name, arguments: args },
            },
            { Authorization: `Bearer ${key}` },
        ),
    );
    expect(response.status).toBe(200);
    const message = await readJsonRpc(response);
    expect(message.error).toBeUndefined();
    return message.result as CallToolResult;
}

function toolText(result: CallToolResult): string {
    const [block] = result.content;
    return block?.type === "text" ? block.text : "";
}

function toolJson<T>(result: CallToolResult): T {
    return JSON.parse(toolText(result)) as T;
}

describe("/api/v1/mcp", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const fake = createFakeDb(seed());
        (db.select as Mock).mockImplementation(fake.select);
        (db.update as Mock).mockImplementation(fake.update);
        (auth.api.getSession as unknown as Mock).mockResolvedValue(null);
        (enforceV1IpRateLimit as Mock).mockResolvedValue(null);
        (enforceV1AuthenticatedRateLimit as Mock).mockResolvedValue(null);
    });

    describe("auth", () => {
        const listBody = { jsonrpc: "2.0", id: 1, method: "tools/list" };

        it("returns 401 with a Bearer challenge when no header is sent", async () => {
            const response = await POST(mcpRequest(listBody));
            expect(response.status).toBe(401);
            expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
            await expect(response.json()).resolves.toMatchObject({
                code: "UNAUTHORIZED",
            });
        });

        it("returns 401 for a malformed or unknown key", async () => {
            for (const value of ["Bearer op_not-a-real-key", "Bearer junk"]) {
                const response = await POST(
                    mcpRequest(listBody, { Authorization: value }),
                );
                expect(response.status).toBe(401);
                expect(response.headers.get("www-authenticate")).toMatch(
                    /^Bearer/,
                );
            }
        });

        it("returns 401 for a browser session without an API key", async () => {
            (auth.api.getSession as unknown as Mock).mockResolvedValue({
                user: { id: "user-a" },
            });
            const response = await POST(
                mcpRequest(listBody, { Cookie: "better-auth.session=abc" }),
            );
            expect(response.status).toBe(401);
            expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
        });

        it("applies the IP limit before auth and the key limit after", async () => {
            const limited = new Response(null, { status: 429 });
            (enforceV1IpRateLimit as Mock).mockResolvedValueOnce(limited);
            const ipLimited = await POST(
                mcpRequest(listBody, { Authorization: `Bearer ${KEY_A}` }),
            );
            expect(ipLimited.status).toBe(429);
            expect(db.select).not.toHaveBeenCalled();

            (enforceV1AuthenticatedRateLimit as Mock).mockResolvedValueOnce(
                limited,
            );
            const keyLimited = await POST(
                mcpRequest(listBody, { Authorization: `Bearer ${KEY_A}` }),
            );
            expect(keyLimited.status).toBe(429);
            expect(enforceV1AuthenticatedRateLimit).toHaveBeenCalledWith({
                user: { id: "user-a" },
                via: "api-key",
                apiKeyId: "key-a",
            });
        });

        it("returns 403 for a suspended account", async () => {
            const tables = seed();
            tables.users[0].suspendedAt = now;
            const fake = createFakeDb(tables);
            (db.select as Mock).mockImplementation(fake.select);
            const response = await POST(
                mcpRequest(listBody, { Authorization: `Bearer ${KEY_A}` }),
            );
            expect(response.status).toBe(403);
            await expect(response.json()).resolves.toMatchObject({
                code: "ACCOUNT_SUSPENDED",
            });
        });
    });

    it("answers GET and DELETE with 405 and Allow: POST", async () => {
        for (const handler of [GET, DELETE]) {
            const response = handler();
            expect(response.status).toBe(405);
            expect(response.headers.get("allow")).toBe("POST");
        }
    });

    it("completes the initialize handshake statelessly", async () => {
        const headers = { Authorization: `Bearer ${KEY_A}` };
        const init = await POST(
            mcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        clientInfo: { name: "test", version: "1.0.0" },
                    },
                },
                headers,
            ),
        );
        expect(init.status).toBe(200);
        expect(init.headers.get("mcp-session-id")).toBeNull();
        const message = await readJsonRpc(init);
        expect(message.result).toMatchObject({
            serverInfo: { name: "riffado" },
            capabilities: { tools: {} },
        });

        const initialized = await POST(
            mcpRequest(
                { jsonrpc: "2.0", method: "notifications/initialized" },
                headers,
            ),
        );
        expect(initialized.status).toBe(202);
    });

    it("lists the read-only tools", async () => {
        const response = await POST(
            mcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list" },
                { Authorization: `Bearer ${KEY_A}` },
            ),
        );
        const message = await readJsonRpc(response);
        const { tools } = message.result as {
            tools: Array<{ name: string; annotations?: unknown }>;
        };
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "get_recording",
            "get_summary",
            "get_transcript",
            "list_recordings",
            "search_recordings",
        ]);
        for (const tool of tools) {
            expect(tool.annotations).toMatchObject({ readOnlyHint: true });
        }
    });

    describe("list_recordings", () => {
        it("returns only the key owner's non-deleted recordings", async () => {
            const page = toolJson<{
                data: Array<{ id: string; title: string }>;
                has_more: boolean;
            }>(await callTool("list_recordings", {}));
            expect(page.data.map((item) => item.id)).toEqual([
                "a-1",
                "a-2",
                "a-3",
            ]);
            expect(page.data[0]).toMatchObject({
                title: "Budget review",
                has_transcription: true,
                has_summary: true,
            });
            expect(page.has_more).toBe(false);

            const other = toolJson<{ data: Array<{ id: string }> }>(
                await callTool("list_recordings", {}, KEY_B),
            );
            expect(other.data.map((item) => item.id)).toEqual(["b-1"]);
        });

        it("pages with limit and returns a cursor", async () => {
            const result = await callTool("list_recordings", { limit: 2 });
            const page = toolJson<{
                data: Array<{ id: string }>;
                next_cursor: string | null;
                has_more: boolean;
            }>(result);
            expect(page.data).toHaveLength(2);
            expect(page.has_more).toBe(true);
            expect(page.next_cursor).toEqual(expect.any(String));
            expect(result.structuredContent).toEqual(page);
        });

        it("rejects an invalid cursor as a tool error", async () => {
            const result = await callTool("list_recordings", {
                cursor: "nope",
            });
            expect(result.isError).toBe(true);
            expect(toolText(result)).toBe("Invalid cursor");
        });
    });

    describe("other users' recordings", () => {
        for (const tool of ["get_recording", "get_transcript", "get_summary"]) {
            it(`${tool} returns Recording not found`, async () => {
                const result = await callTool(tool, { id: "b-1" });
                expect(result.isError).toBe(true);
                expect(toolText(result)).toBe("Recording not found");
                expect(JSON.stringify(result)).not.toContain("Secret");
                expect(JSON.stringify(result)).not.toContain("Private");
            });
        }

        it("treats deleted and unknown ids as not found", async () => {
            for (const id of ["a-deleted", "missing"]) {
                const result = await callTool("get_recording", { id });
                expect(toolText(result)).toBe("Recording not found");
            }
        });
    });

    it("get_recording returns the v1 detail payload", async () => {
        const detail = toolJson<{
            id: string;
            transcript: { text: string } | null;
            summary: { text: string } | null;
        }>(await callTool("get_recording", { id: "a-1" }));
        expect(detail.id).toBe("a-1");
        expect(detail.transcript?.text).toBe("We went over numbers.");
        expect(detail.summary?.text).toBe("Budget was approved");
    });

    it("get_transcript returns the primary transcript", async () => {
        const result = toolJson<{ text: string; source: string }>(
            await callTool("get_transcript", { id: "a-3" }),
        );
        expect(result).toMatchObject({
            text: "The quarterly budget is final.",
            source: "riffado",
        });
    });

    it("get_summary returns the summary or says there is none", async () => {
        const summary = toolJson<{
            text: string;
            action_items: string[];
            key_points: string[];
        }>(await callTool("get_summary", { id: "a-1" }));
        expect(summary).toMatchObject({
            text: "Budget was approved",
            action_items: ["Send report"],
            key_points: ["Approved"],
        });

        const none = await callTool("get_summary", { id: "a-2" });
        expect(none.isError).toBeFalsy();
        expect(toolText(none)).toBe("This recording has no summary yet.");
    });

    describe("search_recordings", () => {
        it("matches transcript text case-insensitively and skips other users", async () => {
            const { data } = toolJson<{
                data: Array<{
                    id: string;
                    matched_in: string[];
                    snippet: string | null;
                }>;
            }>(await callTool("search_recordings", { query: "QUARTERLY" }));
            expect(data.map((match) => match.id)).toEqual(["a-2", "a-3"]);
            expect(data[0].matched_in).toEqual(["transcript"]);
            expect(data[0].snippet).toContain("Quarterly Budget");
            expect(data[0].snippet?.length).toBeLessThanOrEqual(166);
            expect(data[0].snippet?.startsWith("...")).toBe(true);
            expect(JSON.stringify(data)).not.toContain("b-1");
        });

        it("matches titles too", async () => {
            const { data } = toolJson<{
                data: Array<{ id: string; matched_in: string[] }>;
            }>(await callTool("search_recordings", { query: "budget" }));
            expect(data.map((match) => match.id)).toEqual([
                "a-1",
                "a-2",
                "a-3",
            ]);
            expect(data[0].matched_in).toEqual(["title"]);
        });

        it("respects limit", async () => {
            const { data } = toolJson<{ data: Array<{ id: string }> }>(
                await callTool("search_recordings", {
                    query: "budget",
                    limit: 1,
                }),
            );
            expect(data.map((match) => match.id)).toEqual(["a-1"]);
        });

        it("rejects an empty query", async () => {
            const result = await callTool("search_recordings", { query: "" });
            expect(result.isError).toBe(true);
        });
    });
});
