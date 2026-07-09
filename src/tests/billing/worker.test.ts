import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    cycleCloseMock,
    lapseMock,
    deletionMock,
    remindersMock,
    transitionMock,
    reconcileMock,
} = vi.hoisted(() => ({
    cycleCloseMock: { closeDueCycles: vi.fn() },
    lapseMock: { processExpiredTrials: vi.fn() },
    deletionMock: { processDueAccountDeletions: vi.fn() },
    remindersMock: { processGraceReminders: vi.fn() },
    transitionMock: { processTransitionEmails: vi.fn() },
    reconcileMock: { reconcileStaleSubscriptions: vi.fn() },
}));

vi.mock("@/lib/hosted/billing/cycle-close", () => cycleCloseMock);
vi.mock("@/lib/hosted/billing/lapse", () => lapseMock);
vi.mock("@/lib/hosted/billing/deletion", () => deletionMock);
vi.mock("@/lib/hosted/billing/grace-reminders", () => remindersMock);
vi.mock("@/lib/hosted/billing/transition-emails", () => transitionMock);
vi.mock("@/lib/hosted/billing/reconcile", () => reconcileMock);
vi.mock("@/lib/env", () => ({
    env: { IS_HOSTED: true, BILLING_ENABLED: true },
}));

import { tick } from "@/lib/hosted/billing/worker";

function zeroResults() {
    cycleCloseMock.closeDueCycles.mockResolvedValue(0);
    lapseMock.processExpiredTrials.mockResolvedValue({
        lapsed: 0,
        errors: 0,
    });
    deletionMock.processDueAccountDeletions.mockResolvedValue({
        deleted: 0,
        storagePartial: 0,
        errors: 0,
    });
    remindersMock.processGraceReminders.mockResolvedValue({
        reminders: 0,
        lastDay: 0,
        errors: 0,
    });
    transitionMock.processTransitionEmails.mockResolvedValue({
        start: 0,
        reminder: 0,
        ended: 0,
        errors: 0,
    });
    reconcileMock.reconcileStaleSubscriptions.mockResolvedValue({
        inspected: 0,
        errors: 0,
    });
}

describe("billing worker tick", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        zeroResults();
    });

    it("runs every phase in a normal tick", async () => {
        await tick();
        expect(cycleCloseMock.closeDueCycles).toHaveBeenCalled();
        expect(lapseMock.processExpiredTrials).toHaveBeenCalled();
        expect(deletionMock.processDueAccountDeletions).toHaveBeenCalled();
        expect(remindersMock.processGraceReminders).toHaveBeenCalled();
        expect(transitionMock.processTransitionEmails).toHaveBeenCalled();
    });

    it("still runs the later phases when an earlier phase's top-level query throws", async () => {
        cycleCloseMock.closeDueCycles.mockRejectedValue(
            new Error("db connection lost"),
        );
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await tick();
        errorSpy.mockRestore();

        expect(lapseMock.processExpiredTrials).toHaveBeenCalled();
        expect(deletionMock.processDueAccountDeletions).toHaveBeenCalled();
        expect(remindersMock.processGraceReminders).toHaveBeenCalled();
        expect(transitionMock.processTransitionEmails).toHaveBeenCalled();
    });

    it("a middle phase throwing does not block the later phases either", async () => {
        deletionMock.processDueAccountDeletions.mockRejectedValue(
            new Error("storage provider down"),
        );
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await tick();
        errorSpy.mockRestore();

        expect(cycleCloseMock.closeDueCycles).toHaveBeenCalled();
        expect(lapseMock.processExpiredTrials).toHaveBeenCalled();
        expect(remindersMock.processGraceReminders).toHaveBeenCalled();
        expect(transitionMock.processTransitionEmails).toHaveBeenCalled();
    });
});
