import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ConflictConfig {
    target: unknown;
    set: Record<string, unknown>;
    setWhere?: SQL;
}

const { dbMock, captured } = vi.hoisted(() => {
    const captured: { values: unknown; conflict: unknown } = {
        values: null,
        conflict: null,
    };
    const dbMock = {
        insert: vi.fn(() => ({
            values: vi.fn((values: unknown) => {
                captured.values = values;
                return {
                    onConflictDoUpdate: vi.fn((config: unknown) => {
                        captured.conflict = config;
                        return Promise.resolve();
                    }),
                };
            }),
        })),
    };
    return { dbMock, captured };
});

vi.mock("@/db", () => ({ db: dbMock }));

import { recordBounce } from "@/db/queries/email-suppressions";

const dialect = new PgDialect();

describe("#360 recordBounce", () => {
    beforeEach(() => {
        captured.values = null;
        captured.conflict = null;
    });

    it("inserts a lowercased bounce row", async () => {
        await recordBounce("Blocked@Example.COM", "550 no such user");

        expect(captured.values).toEqual({
            email: "blocked@example.com",
            reason: "bounce",
            note: "550 no such user",
        });
    });

    it("on conflict only updates the note, and only when the existing reason is bounce", async () => {
        await recordBounce("blocked@example.com", "550 no such user");

        const conflict = captured.conflict as ConflictConfig;
        expect(conflict.set).toEqual({ note: "550 no such user" });
        expect(conflict.setWhere).toBeDefined();
        const { sql, params } = dialect.sqlToQuery(conflict.setWhere as SQL);
        expect(sql).toBe('"email_suppressions"."reason" = $1');
        expect(params).toEqual(["bounce"]);
    });
});
