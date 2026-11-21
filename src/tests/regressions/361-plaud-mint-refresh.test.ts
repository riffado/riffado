/**
 * Regression test for issue #361.
 *
 * When Plaud rejected the user token on the workspace-token mint, the client
 * fell back to the user token without trying the stored refresh token, and
 * logged that fallback on every background tick. Connections already flagged
 * for reconnect were claimed by the background worker on every tick, sent a
 * PostHog exception each time, and were invisible in the tick log.
 *
 * This file pins: refresh-then-mint before the fallback, at most one refresh
 * per mint rejection, no refresh of a token that was just refreshed, a
 * transient refresh failure falling back instead of failing the request, the
 * once-per-connection-and-code fallback warning, the worker retrying
 * invalidated connections at most once a day, and the `reconnect=N` tick
 * count without exception capture.
 */

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        BACKGROUND_SYNC_ENABLED: true,
        BACKGROUND_SYNC_INTERVAL_MS: 5 * 60 * 1000,
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

vi.mock("@/lib/posthog-server", () => ({
    captureServerEvent: vi.fn(),
    captureServerException: vi.fn(),
}));

import { db } from "@/db";
import { encrypt } from "@/lib/encryption";
import { ErrorCode } from "@/lib/errors";
import {
    createPlaudClient,
    type PlaudConnectionCredentials,
} from "@/lib/plaud/client-factory";
import { captureServerException } from "@/lib/posthog-server";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";
import { claimUsersForSync, tick } from "@/lib/sync/worker";

const USER_ID = "user-361";
const API_BASE = "https://api-euc1.plaud.ai";
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const FALLBACK_WARNING =
    "[plaud] workspace token mint failed, falling back to user token:";

let mockFetch: Mock;
let warnSpy: Mock;
let logSpy: Mock;
const originalFetch = global.fetch;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
    logSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {}) as unknown as Mock;
    vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {}) as unknown as Mock;
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    global.fetch = originalFetch;
});

const nowSec = () => Math.floor(Date.now() / 1000);

function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${header}.${body}.signature-not-checked`;
}

function makeUserToken(tag: string): string {
    return makeJwt({ sub: "user-sub", tag, exp: nowSec() + 20 * HOUR });
}

function makeRefreshToken(tag: string): string {
    return makeJwt({
        sub: "user-sub",
        typ: "refresh",
        tag,
        exp: nowSec() + 20 * DAY,
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

type RouteHandler = (
    url: string,
    init: RequestInit | undefined,
) => Response | Promise<Response>;

function routeFetch(routes: Record<string, RouteHandler>): void {
    mockFetch.mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            for (const [fragment, handler] of Object.entries(routes)) {
                if (url.includes(fragment)) return handler(url, init);
            }
            throw new Error(`unexpected fetch: ${url}`);
        },
    );
}

function authHeader(init: RequestInit | undefined): string | null {
    return new Headers(init?.headers).get("Authorization");
}

function callsTo(fragment: string): [string, RequestInit | undefined][] {
    return (mockFetch.mock.calls as [string, RequestInit | undefined][]).filter(
        ([url]) => String(url).includes(fragment),
    );
}

function bearersTo(fragment: string): (string | null)[] {
    return callsTo(fragment).map(([, init]) => authHeader(init));
}

function fallbackWarnings(): unknown[][] {
    return warnSpy.mock.calls.filter(([msg]) => msg === FALLBACK_WARNING);
}

const unauthorized: RouteHandler = () => jsonResponse({ msg: "bad" }, 401);

const devicesOk: RouteHandler = () =>
    jsonResponse({
        status: 0,
        msg: "success",
        data_devices: [
            { sn: "SN-1", name: "My Plaud", model: "Note", version_number: 1 },
        ],
    });

/** Accept only the listed bearers; reject everything else with a 401. */
function acceptOnly(bearers: string[], ok: RouteHandler): RouteHandler {
    return (url, init) => {
        const header = authHeader(init);
        return bearers.some((b) => header === `Bearer ${b}`)
            ? ok(url, init)
            : unauthorized(url, init);
    };
}

function makeConnection(input: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    accessExpiresInSec?: number;
}): PlaudConnectionCredentials {
    return {
        id: input.id,
        userId: USER_ID,
        bearerToken: encrypt(input.accessToken),
        refreshToken: input.refreshToken ? encrypt(input.refreshToken) : null,
        accessExpiresAt: new Date(
            (nowSec() + (input.accessExpiresInSec ?? 20 * HOUR)) * 1000,
        ),
        sessionExpiresAt: new Date((nowSec() + 20 * DAY) * 1000),
        apiBase: API_BASE,
        workspaceId: "ws_personal",
    };
}

/** `db.update().set().where()` is awaitable and exposes `.returning()`. */
function mockUpdates(connectionId: string): { set: Mock } {
    const returning = vi.fn().mockResolvedValue([{ id: connectionId }]);
    const where = vi.fn(() =>
        Object.assign(Promise.resolve(undefined), { returning }),
    );
    const set = vi.fn().mockReturnValue({ where });
    (db.update as Mock).mockReturnValue({ set });
    return { set };
}

describe("#361 workspace-token mint rejected", () => {
    it("refreshes once, re-mints with the new user token and does not fall back", async () => {
        const id = "conn-refresh-ok";
        mockUpdates(id);
        const oldUt = makeUserToken("old-ut");
        const newUt = makeUserToken("new-ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({
                    status: 0,
                    access_token: newUt,
                    refresh_token: makeRefreshToken("new-rt"),
                }),
            "/workspace/token/": acceptOnly([newUt], () =>
                jsonResponse({
                    status: 0,
                    data: { workspace_token: "wt.fresh" },
                }),
            ),
            "/device/list": acceptOnly(["wt.fresh"], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id,
                accessToken: oldUt,
                refreshToken: makeRefreshToken("old-rt"),
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(bearersTo("/workspace/token/")).toEqual([
            `Bearer ${oldUt}`,
            `Bearer ${newUt}`,
        ]);
        expect(bearersTo("/device/list")).toEqual(["Bearer wt.fresh"]);
        expect(client.usingUserTokenFallback).toBe(false);
        expect(fallbackWarnings()).toHaveLength(0);
    });

    it("falls back to the user token after a rejected refresh, refreshing once", async () => {
        const ut = makeUserToken("ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({ status: -1, msg: "token invalid" }, 401),
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([ut], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id: "conn-refresh-rejected",
                accessToken: ut,
                refreshToken: makeRefreshToken("rt"),
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(callsTo("/workspace/token/")).toHaveLength(1);
        expect(bearersTo("/device/list")).toEqual([`Bearer ${ut}`]);
        expect(client.usingUserTokenFallback).toBe(true);
    });

    it("does not refresh again when the data request also rejects the user token", async () => {
        routeFetch({
            "/auth/refresh-user-token": unauthorized,
            "/workspace/token/": unauthorized,
            "/device/list": unauthorized,
        });

        const client = await createPlaudClient(
            makeConnection({
                id: "conn-dead",
                accessToken: makeUserToken("dead-ut"),
                refreshToken: makeRefreshToken("dead-rt"),
            }),
        );

        await expect(client.listDevices()).rejects.toMatchObject({
            code: ErrorCode.PLAUD_INVALID_TOKEN,
        });
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(callsTo("/workspace/token/")).toHaveLength(1);
    });

    it("falls back to the refreshed user token when the re-mint also fails", async () => {
        const id = "conn-remint-fails";
        mockUpdates(id);
        const newUt = makeUserToken("new-ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({ status: 0, access_token: newUt }),
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([newUt], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id,
                accessToken: makeUserToken("old-ut"),
                refreshToken: makeRefreshToken("rt"),
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(callsTo("/workspace/token/")).toHaveLength(2);
        expect(bearersTo("/device/list")).toEqual([`Bearer ${newUt}`]);
        expect(client.usingUserTokenFallback).toBe(true);
    });

    it("falls back without a refresh call when the connection has no refresh token", async () => {
        const ut = makeUserToken("legacy-ut");
        routeFetch({
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([ut], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id: "conn-legacy",
                accessToken: ut,
                refreshToken: null,
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(0);
        expect(bearersTo("/device/list")).toEqual([`Bearer ${ut}`]);
        expect(client.usingUserTokenFallback).toBe(true);
    });

    it("falls back to the user token when the refresh fails transiently", async () => {
        const ut = makeUserToken("ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({ msg: "unavailable" }, 503),
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([ut], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id: "conn-refresh-transient",
                accessToken: ut,
                refreshToken: makeRefreshToken("rt"),
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(callsTo("/workspace/token/")).toHaveLength(1);
        expect(bearersTo("/device/list")).toEqual([`Bearer ${ut}`]);
        expect(client.usingUserTokenFallback).toBe(true);
    });

    it("does not refresh again on a mint 401 right after a proactive refresh", async () => {
        const id = "conn-proactive";
        mockUpdates(id);
        const newUt = makeUserToken("new-ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({ status: 0, access_token: newUt }),
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([newUt], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id,
                accessToken: makeUserToken("old-ut"),
                refreshToken: makeRefreshToken("rt"),
                accessExpiresInSec: 30 * 60,
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(bearersTo("/workspace/token/")).toEqual([`Bearer ${newUt}`]);
        expect(bearersTo("/device/list")).toEqual([`Bearer ${newUt}`]);
        expect(client.usingUserTokenFallback).toBe(true);
    });

    it("does not refresh again on a re-mint 401 right after a data-path refresh", async () => {
        const id = "conn-data-refresh";
        mockUpdates(id);
        const oldUt = makeUserToken("old-ut");
        const newUt = makeUserToken("new-ut");
        routeFetch({
            "/auth/refresh-user-token": () =>
                jsonResponse({ status: 0, access_token: newUt }),
            "/workspace/token/": acceptOnly([oldUt], () =>
                jsonResponse({
                    status: 0,
                    data: { workspace_token: "wt.old" },
                }),
            ),
            "/device/list": acceptOnly([newUt], devicesOk),
        });

        const client = await createPlaudClient(
            makeConnection({
                id,
                accessToken: oldUt,
                refreshToken: makeRefreshToken("rt"),
            }),
        );
        const devices = await client.listDevices();

        expect(devices.data_devices).toHaveLength(1);
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
        expect(bearersTo("/workspace/token/")).toEqual([
            `Bearer ${oldUt}`,
            `Bearer ${oldUt}`,
            `Bearer ${newUt}`,
        ]);
        expect(bearersTo("/device/list")).toEqual([
            "Bearer wt.old",
            "Bearer wt.old",
            `Bearer ${newUt}`,
        ]);
        expect(client.usingUserTokenFallback).toBe(true);
    });
});

describe("#361 fallback warning", () => {
    it("logs once per connection across client instances in one process", async () => {
        const ut = makeUserToken("ut");
        routeFetch({
            "/workspace/token/": unauthorized,
            "/device/list": acceptOnly([ut], devicesOk),
        });
        const connection = makeConnection({
            id: "conn-log-once",
            accessToken: ut,
            refreshToken: null,
        });

        for (let i = 0; i < 2; i++) {
            const client = await createPlaudClient(connection);
            await client.listDevices();
        }
        expect(fallbackWarnings()).toHaveLength(1);

        const other = await createPlaudClient(
            makeConnection({
                id: "conn-log-once-other",
                accessToken: ut,
                refreshToken: null,
            }),
        );
        await other.listDevices();
        expect(fallbackWarnings()).toHaveLength(2);

        const logged = JSON.stringify(warnSpy.mock.calls);
        expect(logged).not.toContain(ut);
    });

    it("logs a fallback for a different error code on the same connection", async () => {
        const ut = makeUserToken("ut");
        let mint: RouteHandler = unauthorized;
        routeFetch({
            "/workspace/token/": (url, init) => mint(url, init),
            "/device/list": acceptOnly([ut], devicesOk),
        });
        const connection = makeConnection({
            id: "conn-log-per-code",
            accessToken: ut,
            refreshToken: null,
        });

        await (await createPlaudClient(connection)).listDevices();
        expect(fallbackWarnings()).toHaveLength(1);

        mint = () => jsonResponse({ msg: "unavailable" }, 503);
        await (await createPlaudClient(connection)).listDevices();
        expect(fallbackWarnings()).toHaveLength(2);

        mint = unauthorized;
        await (await createPlaudClient(connection)).listDevices();
        expect(fallbackWarnings()).toHaveLength(2);
    });
});

type SelectChain = {
    from: () => SelectChain;
    innerJoin: () => SelectChain;
    where: (where: SQL) => SelectChain;
    orderBy: () => SelectChain;
    limit: () => Promise<unknown[]>;
};

function selectChain(rows: unknown[], onWhere?: (where: SQL) => void) {
    const chain: SelectChain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (where) => {
            onWhere?.(where);
            return chain;
        },
        orderBy: () => chain,
        limit: async () => rows,
    };
    return chain;
}

describe("#361 background worker", () => {
    it("retries connections flagged for reconnect at most once a day", async () => {
        let claimWhere: SQL | undefined;
        (db.select as Mock).mockReturnValueOnce(
            selectChain([], (where) => {
                claimWhere = where;
            }),
        );

        const before = Date.now();
        await claimUsersForSync();

        expect(claimWhere).toBeDefined();
        const { sql, params } = new PgDialect().sqlToQuery(claimWhere as SQL);
        expect(sql).toMatch(
            /\("plaud_connections"."invalidated_at" is null or "plaud_connections"."invalidated_at" < \$\d+\)/,
        );
        const threshold = params.find(
            (p): p is string =>
                typeof p === "string" &&
                Math.abs(Date.parse(p) - (before - DAY * 1000)) < 60_000,
        );
        expect(threshold).toBeDefined();
    });

    it("counts a rejected sign-in as reconnect, not errors or synced, without exception capture", async () => {
        const id = "conn-tick";
        const connection = makeConnection({
            id,
            accessToken: makeUserToken("tick-ut"),
            refreshToken: makeRefreshToken("tick-rt"),
        });
        (db.select as Mock)
            .mockReturnValueOnce(selectChain([{ userId: USER_ID }]))
            .mockReturnValueOnce(selectChain([connection]))
            .mockReturnValueOnce(selectChain([{ id: "settings-1" }]))
            .mockReturnValueOnce(selectChain([{ email: "me@example.com" }]));
        const updates = mockUpdates(id);
        routeFetch({
            "/auth/refresh-user-token": unauthorized,
            "/workspace/token/": unauthorized,
            "/file/simple/web": unauthorized,
        });

        await tick();

        expect(updates.set).toHaveBeenCalledWith(
            expect.objectContaining({ invalidatedAt: expect.any(Date) }),
        );
        expect(logSpy).toHaveBeenCalledWith(
            "[background-sync] synced=0 errors=0 reconnect=1",
        );
        expect(captureServerException).not.toHaveBeenCalled();
        expect(callsTo("/auth/refresh-user-token")).toHaveLength(1);
    });

    it("captures an exception when a rejected sign-in follows other sync errors", async () => {
        const id = "conn-mixed";
        const ut = makeUserToken("mixed-ut");
        const connection = makeConnection({
            id,
            accessToken: ut,
            refreshToken: null,
        });
        (db.select as Mock)
            .mockReturnValueOnce(selectChain([connection]))
            .mockReturnValueOnce(selectChain([{ id: "settings-1" }]))
            .mockReturnValueOnce(selectChain([{ email: "me@example.com" }]));
        mockUpdates(id);
        const firstPage = Array.from({ length: 50 }, (_, i) => ({
            id: `file-${i}`,
            filename: `rec-${i}`,
            version_ms: 1,
        }));
        let listCalls = 0;
        routeFetch({
            "/workspace/token/": () =>
                jsonResponse({ status: 0, data: { workspace_token: "wt" } }),
            "/file/simple/web": () => {
                listCalls++;
                return listCalls === 1
                    ? jsonResponse({
                          status: 0,
                          data_file_total: 100,
                          data_file_list: firstPage,
                      })
                    : unauthorized("", undefined);
            },
        });

        const result = await syncRecordingsForUser(USER_ID, "background");

        expect(result.needsReconnect).toBe(true);
        expect(result.errors.length).toBeGreaterThan(1);
        expect(captureServerException).toHaveBeenCalledTimes(1);
    });
});
