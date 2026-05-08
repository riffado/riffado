import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies that requireApiSession refuses suspended users with an
 * AppError(ACCOUNT_SUSPENDED, 403) and unauthenticated callers with
 * AppError(AUTH_SESSION_MISSING, 401), while letting normal users through.
 *
 * This is the gate that prevents a suspended user with the dashboard
 * already loaded from continuing to hit /api/* endpoints until they
 * reload. Errors flow through the surrounding `apiHandler` wrapper to
 * produce the unified envelope.
 */

const { dbMock, getSessionMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    getSessionMock: vi.fn(),
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: { id: "users.id", suspendedAt: "users.suspendedAt" },
}));
vi.mock("@/lib/auth", () => ({
    auth: { api: { getSession: getSessionMock } },
}));

import { requireApiSession } from "@/lib/auth-server";
import { AppError, ErrorCode } from "@/lib/errors";

function makeChainable(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(result);
    return chain;
}

describe("requireApiSession", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws AUTH_SESSION_MISSING (401) when not authenticated", async () => {
        getSessionMock.mockResolvedValue(null);
        const req = new Request("https://example.com/api/anything");
        try {
            await requireApiSession(req);
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe(ErrorCode.AUTH_SESSION_MISSING);
            expect((err as AppError).statusCode).toBe(401);
        }
    });

    it("returns the session when user is not suspended", async () => {
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(makeChainable([{ suspendedAt: null }]));
        const req = new Request("https://example.com/api/anything");
        const session = await requireApiSession(req);
        expect(session.user.id).toBe("u1");
    });

    it("throws ACCOUNT_SUSPENDED (403) when user is suspended", async () => {
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(
            makeChainable([{ suspendedAt: new Date() }]),
        );
        const req = new Request("https://example.com/api/anything");
        try {
            await requireApiSession(req);
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe(ErrorCode.ACCOUNT_SUSPENDED);
            expect((err as AppError).statusCode).toBe(403);
        }
    });

    it("returns the session when DB lookup returns no row (race: user just deleted)", async () => {
        // If users.id row vanished mid-request, we don't crash; absence of a
        // row means no suspension flag, treat as authenticated. The next
        // call that touches user-owned data will 404 naturally.
        getSessionMock.mockResolvedValue({ user: { id: "u1" } });
        dbMock.select.mockReturnValue(makeChainable([]));
        const req = new Request("https://example.com/api/anything");
        const session = await requireApiSession(req);
        expect(session.user.id).toBe("u1");
    });
});
