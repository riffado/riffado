import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: the grandfathered pre-launch cohort (backfilled to
// `hosted_free` with a `planTransitionUntil`) was claimed by nothing once
// their transition window closed. `claimUsersWithExpiredTrials` filters
// `plan = 'hosted_pro'`, and `scheduleAccountDeletion` is otherwise only
// reached from Stripe cancellation and user-initiated deletion -- so these
// accounts went read-only on schedule and then kept their data forever,
// with no grace reminders and no deletion.

const { queriesMock } = vi.hoisted(() => ({
    queriesMock: {
        claimUsersWithExpiredTransition: vi.fn(),
        scheduleAccountDeletion: vi.fn(),
        setUserPlan: vi.fn(),
    },
}));

vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/posthog-server", () => ({
    captureServerException: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
    env: { BILLING_TRIAL_GRACE_DAYS: 7, BILLING_PAID_GRACE_DAYS: 30 },
}));

import { GRANDFATHERED_GRACE_DAYS } from "@/lib/hosted/billing/grace";
import { processExpiredTransitions } from "@/lib/hosted/billing/grandfather";

function candidate(id: string, windowClosedDaysAgo: number) {
    return {
        id,
        createdAt: new Date("2026-05-01T00:00:00Z"),
        everPaidAt: null,
        planTransitionUntil: new Date(
            Date.now() - windowClosedDaysAgo * 24 * 60 * 60 * 1000,
        ),
    };
}

describe("processExpiredTransitions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns zeros when nothing is claimed", async () => {
        queriesMock.claimUsersWithExpiredTransition.mockResolvedValue([]);

        const result = await processExpiredTransitions();

        expect(result).toEqual({ scheduled: 0, errors: 0 });
        expect(queriesMock.scheduleAccountDeletion).not.toHaveBeenCalled();
    });

    it("gives the cohort a 60-day window measured from now", async () => {
        queriesMock.claimUsersWithExpiredTransition.mockResolvedValue([
            candidate("u_grandfathered", 4),
        ]);

        const result = await processExpiredTransitions();

        expect(result).toEqual({ scheduled: 1, errors: 0 });
        const { userId, scheduledAt } = queriesMock.scheduleAccountDeletion.mock
            .calls[0][0] as { userId: string; scheduledAt: Date };
        expect(userId).toBe("u_grandfathered");
        const expected =
            Date.now() + GRANDFATHERED_GRACE_DAYS * 24 * 60 * 60 * 1000;
        expect(Math.abs(scheduledAt.getTime() - expected)).toBeLessThan(5_000);
    });

    it("is longer than the standard lapsed-subscriber window", () => {
        // The cohort signed up when hosted was free, so they get a wider
        // window than someone who chose a plan and let it lapse.
        expect(GRANDFATHERED_GRACE_DAYS).toBeGreaterThan(30);
    });

    it("does not touch the user's plan", async () => {
        // They are already `hosted_free`; `getEntitlements` locks them out
        // off `planTransitionUntil`. A demote here would be a no-op write
        // and would imply the lockout depends on this phase running.
        queriesMock.claimUsersWithExpiredTransition.mockResolvedValue([
            candidate("u_1", 1),
        ]);

        await processExpiredTransitions();

        expect(queriesMock.setUserPlan).not.toHaveBeenCalled();
    });

    it("counts per-user errors and keeps processing the batch", async () => {
        queriesMock.claimUsersWithExpiredTransition.mockResolvedValue([
            candidate("u_ok", 1),
            candidate("u_bad", 1),
        ]);
        queriesMock.scheduleAccountDeletion
            .mockResolvedValueOnce(new Date())
            .mockRejectedValueOnce(new Error("DB down"));

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await processExpiredTransitions();
        errorSpy.mockRestore();

        expect(result).toEqual({ scheduled: 1, errors: 1 });
    });

    it("forwards an explicit limit and defaults to 100", async () => {
        queriesMock.claimUsersWithExpiredTransition.mockResolvedValue([]);

        await processExpiredTransitions({ limit: 25 });
        expect(
            queriesMock.claimUsersWithExpiredTransition,
        ).toHaveBeenCalledWith(25);

        await processExpiredTransitions();
        expect(
            queriesMock.claimUsersWithExpiredTransition,
        ).toHaveBeenCalledWith(100);
    });
});
