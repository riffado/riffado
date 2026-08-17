import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
    dbMock: { execute: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    billingCustomers: { userId: "user_id" },
    emailLog: { userId: "user_id", kind: "kind" },
    foundingMemberReservations: { id: "id", status: "status" },
    recordings: { userId: "user_id" },
    stripeWebhookEvents: { eventId: "event_id" },
    subscriptions: { status: "status" },
    users: { id: "id", plan: "plan" },
}));

import { claimUsersWithExpiredTransition } from "@/db/queries/billing";

/** Flatten a drizzle SQL template back into its literal fragments. */
function renderedSql(query: SQL): string {
    const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
    return chunks
        .map((chunk) => {
            const value = (chunk as { value?: unknown }).value;
            return Array.isArray(value) ? value.join("") : "";
        })
        .join(" ")
        .replace(/\s+/g, " ");
}

describe("claimUsersWithExpiredTransition", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.execute.mockResolvedValue([]);
    });

    it("claims only the grandfathered cohort, not lapsed trials", async () => {
        await claimUsersWithExpiredTransition(100);

        const query = renderedSql(dbMock.execute.mock.calls[0][0] as SQL);
        expect(query).toContain("u.plan = 'hosted_free'");
        expect(query).toContain("u.plan_transition_until <= now()");
    });

    it("skips accounts that already have a deletion scheduled", async () => {
        // Without this guard the whole cohort is re-claimed every tick.
        await claimUsersWithExpiredTransition(100);

        const query = renderedSql(dbMock.execute.mock.calls[0][0] as SQL);
        expect(query).toContain("u.account_deletion_scheduled_at is null");
    });

    it("requires the read-only notice to have gone out first", async () => {
        await claimUsersWithExpiredTransition(100);

        const query = renderedSql(dbMock.execute.mock.calls[0][0] as SQL);
        expect(query).toContain("e.kind = 'transition_ended'");
    });

    it("skips accounts with a live subscription", async () => {
        await claimUsersWithExpiredTransition(100);

        const query = renderedSql(dbMock.execute.mock.calls[0][0] as SQL);
        expect(query).toContain("'active', 'trialing', 'past_due'");
    });

    it("claims under a row lock that concurrent workers skip", async () => {
        await claimUsersWithExpiredTransition(100);

        const query = renderedSql(dbMock.execute.mock.calls[0][0] as SQL);
        expect(query).toContain("for update of u skip locked");
    });

    it("coerces driver string timestamps to Date", async () => {
        dbMock.execute.mockResolvedValue([
            {
                id: "u_1",
                created_at: "2026-05-01 10:00:00",
                ever_paid_at: null,
                plan_transition_until: "2026-08-20 23:59:59",
            },
        ]);

        const [row] = await claimUsersWithExpiredTransition(100);

        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.planTransitionUntil).toBeInstanceOf(Date);
        expect(row.everPaidAt).toBeNull();
    });
});
