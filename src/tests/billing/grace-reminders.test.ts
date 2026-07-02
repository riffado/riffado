import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emailMock, envMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    emailMock: {
        sendGraceReminderEmail: vi.fn(),
        sendGraceLastDayEmail: vi.fn(),
    },
    envMock: {
        APP_URL: "https://app.example.com" as string | undefined,
        BILLING_LAUNCH_DATE: undefined as string | undefined,
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: {
        id: "id",
        email: "email",
        createdAt: "createdAt",
        everPaidAt: "everPaidAt",
        accountDeletionScheduledAt: "accountDeletionScheduledAt",
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/notifications/email", () => emailMock);

import { processGraceReminders } from "@/lib/hosted/billing/grace-reminders";

interface CandidateRow {
    id: string;
    email: string;
    createdAt?: Date;
    everPaidAt?: Date | null;
    deletionAt: Date | null;
}

/**
 * Queues two `db.select` calls: the reminder query then the last-day
 * query. processGraceReminders runs them in that order.
 */
function queueQueries(input: {
    reminders: CandidateRow[];
    lastDay: CandidateRow[];
}) {
    const buildChain = (rows: CandidateRow[]) => ({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
            }),
        }),
    });
    dbMock.select
        .mockReturnValueOnce(buildChain(input.reminders))
        .mockReturnValueOnce(buildChain(input.lastDay));
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("processGraceReminders", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.APP_URL = "https://app.example.com";
        envMock.BILLING_LAUNCH_DATE = undefined;
        emailMock.sendGraceReminderEmail.mockResolvedValue(true);
        emailMock.sendGraceLastDayEmail.mockResolvedValue(true);
    });

    it("returns zeros when APP_URL is not configured", async () => {
        envMock.APP_URL = undefined;
        const result = await processGraceReminders();
        expect(result).toEqual({ reminders: 0, lastDay: 0, errors: 0 });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("sends a reminder at T-3 for trial path users", async () => {
        const deletionAt = new Date(NOW + 2.5 * DAY);
        queueQueries({
            reminders: [
                {
                    id: "u_trial",
                    email: "trial@example.com",
                    createdAt: new Date(NOW - 4 * DAY),
                    everPaidAt: null,
                    deletionAt,
                },
            ],
            lastDay: [],
        });

        const result = await processGraceReminders();

        expect(result.reminders).toBe(1);
        expect(emailMock.sendGraceReminderEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "u_trial",
                email: "trial@example.com",
                deletionAt,
            }),
        );
    });

    it("does not send a trial-path reminder when the user is still > 3 days out", async () => {
        const deletionAt = new Date(NOW + 5 * DAY);
        queueQueries({
            reminders: [
                {
                    id: "u_trial",
                    email: "trial@example.com",
                    createdAt: new Date(NOW - 2 * DAY),
                    everPaidAt: null,
                    deletionAt,
                },
            ],
            lastDay: [],
        });

        const result = await processGraceReminders();

        expect(result.reminders).toBe(0);
        expect(emailMock.sendGraceReminderEmail).not.toHaveBeenCalled();
    });

    it("sends a reminder at T-7 for paid-path users", async () => {
        const deletionAt = new Date(NOW + 6 * DAY);
        queueQueries({
            reminders: [
                {
                    id: "u_paid",
                    email: "paid@example.com",
                    createdAt: new Date(NOW - 10 * DAY),
                    everPaidAt: new Date(NOW - 9 * DAY),
                    deletionAt,
                },
            ],
            lastDay: [],
        });

        const result = await processGraceReminders();

        expect(result.reminders).toBe(1);
    });

    it("classifies pre-launch users as paid path (grandfather)", async () => {
        envMock.BILLING_LAUNCH_DATE = "2026-06-01";
        const preLaunch = new Date("2026-05-15T00:00:00Z");
        const deletionAt = new Date(NOW + 5 * DAY);
        queueQueries({
            reminders: [
                {
                    id: "u_pre",
                    email: "pre@example.com",
                    createdAt: preLaunch,
                    everPaidAt: null,
                    deletionAt,
                },
            ],
            lastDay: [],
        });

        const result = await processGraceReminders();

        expect(result.reminders).toBe(1);
    });

    it("skips reminder when within the last-24h band (last-day notice owns it)", async () => {
        const deletionAt = new Date(NOW + 12 * HOUR);
        queueQueries({
            reminders: [
                {
                    id: "u",
                    email: "u@example.com",
                    createdAt: new Date(NOW - 2 * DAY),
                    everPaidAt: null,
                    deletionAt,
                },
            ],
            lastDay: [],
        });

        const result = await processGraceReminders();

        expect(result.reminders).toBe(0);
        expect(emailMock.sendGraceReminderEmail).not.toHaveBeenCalled();
    });

    it("sends a last-day email to any user with <24h left", async () => {
        const deletionAt = new Date(NOW + 12 * HOUR);
        queueQueries({
            reminders: [],
            lastDay: [
                {
                    id: "u",
                    email: "u@example.com",
                    deletionAt,
                },
            ],
        });

        const result = await processGraceReminders();

        expect(result.lastDay).toBe(1);
        expect(emailMock.sendGraceLastDayEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "u",
                deletionAt,
            }),
        );
    });

    it("counts per-user errors without aborting the batch", async () => {
        const deletionAt = new Date(NOW + 12 * HOUR);
        queueQueries({
            reminders: [],
            lastDay: [
                { id: "a", email: "a@example.com", deletionAt },
                { id: "b", email: "b@example.com", deletionAt },
            ],
        });
        emailMock.sendGraceLastDayEmail
            .mockResolvedValueOnce(true)
            .mockRejectedValueOnce(new Error("smtp down"));

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await processGraceReminders();
        errorSpy.mockRestore();

        expect(result.lastDay).toBe(1);
        expect(result.errors).toBe(1);
    });

    it("treats dedup-suppressed sends as non-counted (no double-count of skipped sends)", async () => {
        const deletionAt = new Date(NOW + 12 * HOUR);
        queueQueries({
            reminders: [],
            lastDay: [{ id: "u", email: "u@example.com", deletionAt }],
        });
        emailMock.sendGraceLastDayEmail.mockResolvedValueOnce(false);

        const result = await processGraceReminders();

        expect(result.lastDay).toBe(0);
        expect(result.errors).toBe(0);
    });
});
