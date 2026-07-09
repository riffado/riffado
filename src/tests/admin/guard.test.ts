import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        IS_HOSTED: false,
        ADMIN_EMAILS: [],
        ADMIN_IP_ALLOWLIST: [],
        ADMIN_REAUTH_TTL_MINUTES: 30,
        ADMIN_MUTATION_TTL_MINUTES: 10,
        BETTER_AUTH_SECRET: "better-auth-secret-with-32-chars",
    },
}));

vi.mock("@/db", () => ({
    db: {
        insert: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

import { ErrorCode } from "@/lib/errors";
import {
    requireAdminApi,
    requireAdminMutation,
} from "@/lib/hosted/admin/guard";

describe("admin API guard", () => {
    it("throws a JSON-mappable 404 AppError for failed API reads", async () => {
        await expect(
            requireAdminApi({
                route: "/api/admin/example",
                method: "GET",
            }),
        ).rejects.toMatchObject({
            code: ErrorCode.NOT_FOUND,
            statusCode: 404,
        });
    });

    it("throws a JSON-mappable 404 AppError for failed mutations", async () => {
        await expect(
            requireAdminMutation({
                route: "/api/admin/actions/example",
                method: "POST",
            }),
        ).rejects.toMatchObject({
            code: ErrorCode.NOT_FOUND,
            statusCode: 404,
        });
    });
});
