import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emailMock, envMock, queriesMock, posthogMock } = vi.hoisted(
    () => ({
        dbMock: { select: vi.fn() },
        emailMock: { sendGraceStartedEmail: vi.fn() },
        envMock: {
            BILLING_TRIAL_GRACE_DAYS: 7,
            BILLING_PAID_GRACE_DAYS: 30,
            BILLING_LAUNCH_DATE: undefined as string | undefined,
            APP_URL: "https://app.example.com",
        },
        queriesMock: {
            claimUsersWithExpiredTrials: vi.fn(),
            scheduleAccountDeletion: vi.fn(),
            setUserPlan: vi.fn(),
        },
        posthogMock: { captureServerException: vi.fn() },
    }),
);

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/notifications/email", () => emailMock);
vi.mock("@/lib/posthog-server", () => posthogMock);

function stubEmailLookup(email: string | null) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(email ? [{ email }] : []),
            }),
        }),
    });
}

import { processExpiredTrials } from "@/lib/hosted/billing/lapse";

describe("processExpiredTrials", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.BILLING_TRIAL_GRACE_DAYS = 7;
        envMock.BILLING_PAID_GRACE_DAYS = 30;
        envMock.BILLING_LAUNCH_DATE = undefined;
        envMock.APP_URL = "https://app.example.com";
        emailMock.sendGraceStartedEmail.mockResolvedValue(true);
        stubEmailLookup("default@example.com");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Grace starts at the later of trial end and now (#277), so a test that
     * asserts an exact `lapseAt + grace` deletion date has to run at the
     * moment the trial expired -- which is what steady state looks like.
     */
    function freezeClockAt(instant: Date) {
        vi.useFakeTimers();
        vi.setSystemTime(instant);
    }

    it("returns zeros when no candidates", async () => {
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([]);
        const result = await processExpiredTrials();
        expect(result).toEqual({ lapsed: 0, errors: 0 });
        expect(queriesMock.setUserPlan).not.toHaveBeenCalled();
        expect(queriesMock.scheduleAccountDeletion).not.toHaveBeenCalled();
    });

    it("demotes a post-launch no-card trial to hosted_free and schedules 7-day deletion", async () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const lapseAt = new Date("2026-07-15T12:00:00Z");
        freezeClockAt(lapseAt);
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_trial",
                createdAt: new Date("2026-07-01T00:00:00Z"),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
        ]);

        const result = await processExpiredTrials();

        expect(result).toEqual({ lapsed: 1, errors: 0 });
        expect(queriesMock.setUserPlan).toHaveBeenCalledWith({
            userId: "u_trial",
            plan: "hosted_free",
        });
        const expectedDeletion = new Date(
            lapseAt.getTime() + 7 * 24 * 60 * 60 * 1000,
        );
        expect(queriesMock.scheduleAccountDeletion).toHaveBeenCalledWith({
            userId: "u_trial",
            scheduledAt: expectedDeletion,
        });
    });

    it("grandfathers pre-launch users into the 30-day paid grace", async () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const lapseAt = new Date("2026-07-15T12:00:00Z");
        freezeClockAt(lapseAt);
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_pre",
                createdAt: new Date("2026-05-15T00:00:00Z"),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
        ]);

        await processExpiredTrials();

        const expectedDeletion = new Date(
            lapseAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        expect(queriesMock.scheduleAccountDeletion).toHaveBeenCalledWith({
            userId: "u_pre",
            scheduledAt: expectedDeletion,
        });
    });

    it("uses the paid grace window for users who have ever paid", async () => {
        const lapseAt = new Date("2026-07-15T12:00:00Z");
        freezeClockAt(lapseAt);
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_paid",
                createdAt: new Date("2026-07-01T00:00:00Z"),
                everPaidAt: new Date("2026-07-02T00:00:00Z"),
                planTransitionUntil: lapseAt,
            },
        ]);

        await processExpiredTrials();

        const expectedDeletion = new Date(
            lapseAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        expect(queriesMock.scheduleAccountDeletion).toHaveBeenCalledWith({
            userId: "u_paid",
            scheduledAt: expectedDeletion,
        });
    });

    it("falls back to now() when planTransitionUntil is missing", async () => {
        const now = Date.now();
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_x",
                createdAt: new Date("2026-07-01T00:00:00Z"),
                everPaidAt: null,
                planTransitionUntil: null,
            },
        ]);

        await processExpiredTrials();

        const call = queriesMock.scheduleAccountDeletion.mock.calls[0][0];
        const scheduledAt = (call.scheduledAt as Date).getTime();
        const expectedMin = now + 7 * 24 * 60 * 60 * 1000 - 5_000;
        const expectedMax = now + 7 * 24 * 60 * 60 * 1000 + 5_000;
        expect(scheduledAt).toBeGreaterThanOrEqual(expectedMin);
        expect(scheduledAt).toBeLessThanOrEqual(expectedMax);
    });

    it("starts grace at now, not trial end, for a long-overdue lapse (#277)", async () => {
        // The phase was down for days, so trial end is further in the past
        // than the grace window itself. Measuring grace from trial end would
        // schedule deletion retroactively, and the `deletion` phase runs
        // right after `trial-lapse` in the same tick.
        const lapseAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_overdue",
                createdAt: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
        ]);

        await processExpiredTrials();

        const { scheduledAt } = queriesMock.scheduleAccountDeletion.mock
            .calls[0][0] as { scheduledAt: Date };
        expect(scheduledAt.getTime()).toBeGreaterThan(Date.now());
        const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
        expect(Math.abs(scheduledAt.getTime() - expected)).toBeLessThan(5_000);
    });

    it("keeps a future trial end as the grace start", async () => {
        // Defensive: the claim only returns elapsed windows, but if a row
        // with a future window ever arrives, grace must not be shortened.
        const lapseAt = new Date(Date.now() + 60 * 60 * 1000);
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "u_future",
                createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
        ]);

        await processExpiredTrials();

        expect(queriesMock.scheduleAccountDeletion).toHaveBeenCalledWith({
            userId: "u_future",
            scheduledAt: new Date(lapseAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        });
    });

    it("counts per-user errors and continues processing the batch", async () => {
        const lapseAt = new Date("2026-07-15T12:00:00Z");
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([
            {
                id: "a",
                createdAt: new Date("2026-07-01T00:00:00Z"),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
            {
                id: "b",
                createdAt: new Date("2026-07-01T00:00:00Z"),
                everPaidAt: null,
                planTransitionUntil: lapseAt,
            },
        ]);
        queriesMock.setUserPlan
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("DB down"));
        stubEmailLookup("a@example.com");

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await processExpiredTrials();
        errorSpy.mockRestore();

        expect(result).toEqual({ lapsed: 1, errors: 1 });
        expect(posthogMock.captureServerException).toHaveBeenCalledWith(
            expect.any(Error),
            {
                source: "worker:billing",
                phase: "trial-lapse",
                distinctId: "b",
            },
        );
    });

    it("forwards an explicit limit to the claim query", async () => {
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([]);
        await processExpiredTrials({ limit: 10 });
        expect(queriesMock.claimUsersWithExpiredTrials).toHaveBeenCalledWith(
            10,
        );
    });

    it("defaults the limit to 100 when omitted", async () => {
        queriesMock.claimUsersWithExpiredTrials.mockResolvedValue([]);
        await processExpiredTrials();
        expect(queriesMock.claimUsersWithExpiredTrials).toHaveBeenCalledWith(
            100,
        );
    });
});
