/**
 * Regression for issue #241 auto-transcribe retry eligibility.
 * keep_both must require a missing Riffado-source transcript; plaud_only
 * treats any transcript row as done. Exercises the real query builder,
 * not the sync.test.ts mock of listUntranscribedRecordingIds.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

import { db } from "@/db";
import { transcriptions } from "@/db/schema";
import { listUntranscribedRecordingIds } from "@/lib/sync/untranscribed";

function exprReferences(
    expr: unknown,
    target: unknown,
    seen = new Set<unknown>(),
): boolean {
    if (expr == null) return false;
    if (expr === target) return true;
    if (typeof expr !== "object") return false;
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
            if (value.some((item) => exprReferences(item, target, seen))) {
                return true;
            }
        } else if (exprReferences(value, target, seen)) {
            return true;
        }
    }
    return false;
}

function captureWhereExprs(): unknown[] {
    const whereExprs: unknown[] = [];
    (db.select as Mock).mockImplementation(() => {
        const chain: {
            from: Mock;
            where: Mock;
            orderBy: Mock;
            limit: Mock;
        } = {
            from: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn().mockResolvedValue([]),
        };
        chain.from.mockReturnValue(chain);
        chain.where.mockImplementation((expr: unknown) => {
            whereExprs.push(expr);
            return chain;
        });
        chain.orderBy.mockReturnValue(chain);
        return chain;
    });
    return whereExprs;
}

describe("issue #241: auto-transcribe retry source predicate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("plaud_only exists-check does not scope to the riffado source", async () => {
        const whereExprs = captureWhereExprs();
        await listUntranscribedRecordingIds("user-1", {
            transcriptMode: "plaud_only",
        });
        const existsWhere = whereExprs[0];
        expect(existsWhere).toBeDefined();
        expect(exprReferences(existsWhere, transcriptions.userId)).toBe(true);
        expect(exprReferences(existsWhere, transcriptions.source)).toBe(false);
        expect(exprReferences(existsWhere, "riffado")).toBe(false);
    });

    it("keep_both exists-check requires a missing riffado-source transcript", async () => {
        const whereExprs = captureWhereExprs();
        await listUntranscribedRecordingIds("user-1", {
            transcriptMode: "keep_both",
        });
        const existsWhere = whereExprs[0];
        expect(existsWhere).toBeDefined();
        expect(exprReferences(existsWhere, transcriptions.userId)).toBe(true);
        expect(exprReferences(existsWhere, transcriptions.source)).toBe(true);
        expect(exprReferences(existsWhere, "riffado")).toBe(true);
    });
});
