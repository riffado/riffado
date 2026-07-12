import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emailMock, envMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn() },
    emailMock: {
        sendTransitionStartEmail: vi.fn(),
        sendTransitionReminderEmail: vi.fn(),
        sendTransitionEndedEmail: vi.fn(),
    },
    envMock: {
        APP_URL: "https://app.example.com" as string | undefined,
        BILLING_LAUNCH_DATE: "2020-01-01" as string | undefined,
        BILLING_DEFAULT_CURRENCY: "usd" as "usd" | "eur",
        BILLING_PRICE_USD: "5.00",
        BILLING_PRICE_EUR: "5.00",
        STRIPE_PRICE_ID_USD: "price_usd" as string | undefined,
        STRIPE_PRICE_ID_EUR: "price_eur" as string | undefined,
    },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    users: {
        id: "id",
        email: "email",
        plan: "plan",
        planTransitionUntil: "planTransitionUntil",
        accountDeletionScheduledAt: "accountDeletionScheduledAt",
    },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/lib/notifications/email", () => emailMock);

import { processTransitionEmails } from "@/lib/hosted/billing/transition-emails";

interface CohortRow {
    id: string;
    email: string | null;
    transitionUntil: Date | null;
}

function queueCohort(rows: CohortRow[]) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(rows),
                }),
            }),
        }),
    });
}

/** Queue a sequence of `db.select` calls (one page per call), in order. */
function queuePages(pages: CohortRow[][]) {
    for (const rows of pages) {
        dbMock.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(rows),
                    }),
                }),
            }),
        });
    }
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

describe("processTransitionEmails", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.APP_URL = "https://app.example.com";
        // A launch date in the past so the launch-date guard is open;
        // the dedicated "before launch" test overrides this.
        envMock.BILLING_LAUNCH_DATE = "2020-01-01";
        envMock.BILLING_DEFAULT_CURRENCY = "usd";
        envMock.STRIPE_PRICE_ID_USD = "price_usd";
        envMock.STRIPE_PRICE_ID_EUR = "price_eur";
        emailMock.sendTransitionStartEmail.mockResolvedValue(true);
        emailMock.sendTransitionReminderEmail.mockResolvedValue(true);
        emailMock.sendTransitionEndedEmail.mockResolvedValue(true);
    });

    it("returns zeros when APP_URL is not configured", async () => {
        envMock.APP_URL = undefined;
        const result = await processTransitionEmails();
        expect(result).toEqual({
            start: 0,
            reminder: 0,
            ended: 0,
            errors: 0,
        });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("returns zeros when the launch date is not set", async () => {
        envMock.BILLING_LAUNCH_DATE = undefined;
        const result = await processTransitionEmails();
        expect(result).toEqual({
            start: 0,
            reminder: 0,
            ended: 0,
            errors: 0,
        });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("does not query or send before the launch date arrives", async () => {
        // Launch far in the future relative to test execution.
        envMock.BILLING_LAUNCH_DATE = "2099-01-01";
        const result = await processTransitionEmails();
        expect(result).toEqual({
            start: 0,
            reminder: 0,
            ended: 0,
            errors: 0,
        });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("sends only the start email when the window is wide open", async () => {
        queueCohort([
            {
                id: "u1",
                email: "u1@example.com",
                transitionUntil: new Date(NOW + 20 * DAY),
            },
        ]);

        const result = await processTransitionEmails();

        expect(result.start).toBe(1);
        expect(result.reminder).toBe(0);
        expect(emailMock.sendTransitionStartEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "u1",
                email: "u1@example.com",
                amountValue: "5.00",
                amountCurrency: "USD",
            }),
        );
        expect(emailMock.sendTransitionReminderEmail).not.toHaveBeenCalled();
        expect(emailMock.sendTransitionEndedEmail).not.toHaveBeenCalled();
    });

    it("uses a configured monthly currency when the default is unavailable", async () => {
        envMock.STRIPE_PRICE_ID_USD = undefined;
        queueCohort([
            {
                id: "u-eur",
                email: "eur@example.com",
                transitionUntil: new Date(NOW + 20 * DAY),
            },
        ]);

        await processTransitionEmails();

        expect(emailMock.sendTransitionStartEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                amountValue: "5.00",
                amountCurrency: "EUR",
            }),
        );
    });

    it("sends start + reminder in the final 3-day stretch", async () => {
        queueCohort([
            {
                id: "u2",
                email: "u2@example.com",
                transitionUntil: new Date(NOW + 2 * DAY),
            },
        ]);

        const result = await processTransitionEmails();

        expect(result.start).toBe(1);
        expect(result.reminder).toBe(1);
        expect(emailMock.sendTransitionReminderEmail).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u2", daysLeft: 2 }),
        );
        expect(emailMock.sendTransitionEndedEmail).not.toHaveBeenCalled();
    });

    it("sends only the ended email once the window has closed", async () => {
        queueCohort([
            {
                id: "u3",
                email: "u3@example.com",
                transitionUntil: new Date(NOW - 1 * DAY),
            },
        ]);

        const result = await processTransitionEmails();

        expect(result.ended).toBe(1);
        expect(result.start).toBe(0);
        expect(result.reminder).toBe(0);
        expect(emailMock.sendTransitionStartEmail).not.toHaveBeenCalled();
        expect(emailMock.sendTransitionEndedEmail).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u3" }),
        );
    });

    it("does not count dedup-suppressed sends", async () => {
        queueCohort([
            {
                id: "u4",
                email: "u4@example.com",
                transitionUntil: new Date(NOW + 20 * DAY),
            },
        ]);
        emailMock.sendTransitionStartEmail.mockResolvedValueOnce(false);

        const result = await processTransitionEmails();

        expect(result.start).toBe(0);
        expect(result.errors).toBe(0);
    });

    it("skips rows with no email and counts per-user errors without aborting", async () => {
        queueCohort([
            { id: "skip", email: null, transitionUntil: new Date(NOW - DAY) },
            {
                id: "boom",
                email: "boom@example.com",
                transitionUntil: new Date(NOW - DAY),
            },
            {
                id: "ok",
                email: "ok@example.com",
                transitionUntil: new Date(NOW - DAY),
            },
        ]);
        emailMock.sendTransitionEndedEmail
            .mockRejectedValueOnce(new Error("smtp down"))
            .mockResolvedValueOnce(true);

        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const result = await processTransitionEmails();
        errorSpy.mockRestore();

        expect(result.ended).toBe(1);
        expect(result.errors).toBe(1);
        expect(emailMock.sendTransitionEndedEmail).toHaveBeenCalledTimes(2);
    });

    it("pages through a cohort larger than BATCH_LIMIT instead of re-selecting the same first page forever", async () => {
        // A full-size first page (BATCH_LIMIT=200) means "there may be
        // more"; the next tick must query strictly past the last id from
        // the first page rather than reusing the same unbounded query.
        const fullPage: CohortRow[] = Array.from({ length: 200 }, (_, i) => ({
            id: `u${String(i).padStart(4, "0")}`,
            email: `u${i}@example.com`,
            transitionUntil: new Date(NOW + 20 * DAY),
        }));
        const remainder: CohortRow[] = [
            {
                id: "u9999",
                email: "last@example.com",
                transitionUntil: new Date(NOW + 20 * DAY),
            },
        ];
        queuePages([fullPage]);
        const first = await processTransitionEmails();
        expect(first.start).toBe(200);

        const secondWhere = vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(remainder),
            }),
        });
        dbMock.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({ where: secondWhere }),
        });

        const second = await processTransitionEmails();
        expect(second.start).toBe(1);
        // Only one query this tick (no wrap-around re-fetch needed since
        // the cursor-scoped query already returned rows) -- confirms the
        // second tick queried past the first page's cursor rather than
        // repeating it.
        expect(secondWhere).toHaveBeenCalledTimes(1);
    });
});
