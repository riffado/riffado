import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emailMock, envMock, queriesMock } = vi.hoisted(() => ({
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
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db/queries/billing", () => queriesMock);
vi.mock("@/lib/notifications/email", () => emailMock);

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
