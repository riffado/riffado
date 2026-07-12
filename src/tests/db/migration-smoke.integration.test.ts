import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    createMigratedTestDatabase,
    getTestDatabaseUrl,
    type TestPostgresDatabase,
} from "@/tests/integration/postgres";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL migration chain", () => {
    let database: TestPostgresDatabase | null = null;

    beforeAll(async () => {
        database = await createMigratedTestDatabase(
            testDatabaseUrl ?? "",
            "migration_smoke",
        );
    }, 120_000);

    afterAll(async () => {
        await database?.dispose();
    }, 30_000);

    it("applies every migration to an empty database", async () => {
        if (!database) throw new Error("test database was not initialized");

        const rows = await database.sql<
            { users_table: string | null; founding_table: string | null }[]
        >`
            select
                to_regclass('public.users')::text as users_table,
                to_regclass('public.founding_member_reservations')::text as founding_table
        `;

        expect(rows[0]).toEqual({
            users_table: "users",
            founding_table: "founding_member_reservations",
        });
    });
});
