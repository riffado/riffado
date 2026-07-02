import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
    envMock: {
        BILLING_TRIAL_GRACE_DAYS: 7,
        BILLING_PAID_GRACE_DAYS: 30,
        BILLING_LAUNCH_DATE: undefined as string | undefined,
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import {
    classifyGracePath,
    computeDeletionScheduledAt,
    graceDaysForPath,
} from "@/lib/hosted/billing/grace";

describe("classifyGracePath", () => {
    beforeEach(() => {
        envMock.BILLING_TRIAL_GRACE_DAYS = 7;
        envMock.BILLING_PAID_GRACE_DAYS = 30;
        envMock.BILLING_LAUNCH_DATE = undefined;
    });

    it("returns 'paid' when the user has ever paid (regardless of launch date)", () => {
        const path = classifyGracePath({
            createdAt: new Date("2026-07-01T00:00:00Z"),
            everPaidAt: new Date("2026-07-15T00:00:00Z"),
        });
        expect(path).toBe("paid");
    });

    it("returns 'trial' for never-paid users when no launch date is configured", () => {
        const path = classifyGracePath({
            createdAt: new Date("2026-07-01T00:00:00Z"),
            everPaidAt: null,
        });
        expect(path).toBe("trial");
    });

    it("returns 'paid' for never-paid users created before BILLING_LAUNCH_DATE (grandfather)", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const path = classifyGracePath({
            createdAt: new Date("2026-05-30T00:00:00Z"),
            everPaidAt: null,
        });
        expect(path).toBe("paid");
    });

    it("returns 'trial' for never-paid users created on or after BILLING_LAUNCH_DATE", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const path = classifyGracePath({
            createdAt: new Date("2026-06-01T00:00:00Z"),
            everPaidAt: null,
        });
        expect(path).toBe("trial");
    });

    it("treats UTC midnight as the launch boundary (no timezone surprises)", () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const justBefore = classifyGracePath({
            createdAt: new Date("2026-05-31T23:59:59Z"),
            everPaidAt: null,
        });
        const justAfter = classifyGracePath({
            createdAt: new Date("2026-06-01T00:00:01Z"),
            everPaidAt: null,
        });
        expect(justBefore).toBe("paid");
        expect(justAfter).toBe("trial");
    });
});

describe("graceDaysForPath", () => {
    beforeEach(() => {
        envMock.BILLING_TRIAL_GRACE_DAYS = 7;
        envMock.BILLING_PAID_GRACE_DAYS = 30;
    });

    it("returns the trial grace days for 'trial'", () => {
        expect(graceDaysForPath("trial")).toBe(7);
    });

    it("returns the paid grace days for 'paid'", () => {
        expect(graceDaysForPath("paid")).toBe(30);
    });

    it("honors env overrides", () => {
        envMock.BILLING_TRIAL_GRACE_DAYS = 3;
        envMock.BILLING_PAID_GRACE_DAYS = 90;
        expect(graceDaysForPath("trial")).toBe(3);
        expect(graceDaysForPath("paid")).toBe(90);
    });
});

describe("computeDeletionScheduledAt", () => {
    beforeEach(() => {
        envMock.BILLING_TRIAL_GRACE_DAYS = 7;
        envMock.BILLING_PAID_GRACE_DAYS = 30;
    });

    it("adds 7 days to the lapse moment for the trial path", () => {
        const lapseAt = new Date("2026-07-01T12:00:00Z");
        const expected = new Date("2026-07-08T12:00:00Z");
        expect(
            computeDeletionScheduledAt({ lapseAt, path: "trial" }).getTime(),
        ).toBe(expected.getTime());
    });

    it("adds 30 days to the lapse moment for the paid path", () => {
        const lapseAt = new Date("2026-07-01T12:00:00Z");
        const expected = new Date("2026-07-31T12:00:00Z");
        expect(
            computeDeletionScheduledAt({ lapseAt, path: "paid" }).getTime(),
        ).toBe(expected.getTime());
    });
});
