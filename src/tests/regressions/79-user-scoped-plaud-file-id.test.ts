import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { recordings } from "@/db/schema";

describe("Issue #79 - hosted sync schema", () => {
    it("scopes Plaud file id uniqueness per user", () => {
        const config = getTableConfig(recordings);
        const plaudFileColumn = config.columns.find(
            (column) => column.name === "plaud_file_id",
        ) as { isUnique?: boolean } | undefined;

        const uniqueConstraints = config.uniqueConstraints.map(
            (constraint) => ({
                name: constraint.getName(),
                columns: constraint.columns.map((column) => column.name),
            }),
        );

        expect(plaudFileColumn?.isUnique).toBe(false);
        expect(uniqueConstraints).toContainEqual({
            name: "recordings_user_id_plaud_file_id_unique",
            columns: ["user_id", "plaud_file_id"],
        });
    });
});
