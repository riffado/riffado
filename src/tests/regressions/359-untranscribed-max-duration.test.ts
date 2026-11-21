/**
 * Regression for #359 starvation. The retry selection must only consider
 * recordings that fit the caller's budget, so recordings that are too long
 * cannot occupy the newest-first window and hide older ones that fit.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
    },
}));

import { db } from "@/db";
import { recordings } from "@/db/schema";
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

describe("#359: untranscribed query duration cap", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("filters on recordings.duration when maxDurationMs is set", async () => {
        const whereExprs = captureWhereExprs();

        await listUntranscribedRecordingIds("user-1", {
            maxDurationMs: 123_456,
        });

        const outer = whereExprs[whereExprs.length - 1];
        expect(exprReferences(outer, recordings.duration)).toBe(true);
        expect(exprReferences(outer, 123_456)).toBe(true);
    });

    it("does not filter on recordings.duration without maxDurationMs", async () => {
        const whereExprs = captureWhereExprs();

        await listUntranscribedRecordingIds("user-1");

        const outer = whereExprs[whereExprs.length - 1];
        expect(exprReferences(outer, recordings.duration)).toBe(false);
    });
});
