import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
    dbMock: { select: vi.fn(), insert: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({
    emailCampaigns: { slug: "slug" },
}));

import { getCampaignBySlug } from "@/db/queries/email-campaigns";

function stubSelect(row: Record<string, unknown> | undefined) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(row ? [row] : []),
            }),
        }),
    });
}

describe("getCampaignBySlug", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the row's kind verbatim when it's a recognized value", async () => {
        stubSelect({
            id: "c1",
            slug: "welcome",
            subject: "Welcome",
            kind: "transactional",
            createdAt: new Date(),
        });
        const row = await getCampaignBySlug("welcome");
        expect(row?.kind).toBe("transactional");
    });

    it("normalizes an unrecognized DB value to 'marketing' instead of trusting the cast", async () => {
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        stubSelect({
            id: "c1",
            slug: "weird",
            subject: "Weird",
            kind: "not-a-real-kind",
            createdAt: new Date(),
        });
        const row = await getCampaignBySlug("weird");
        errorSpy.mockRestore();
        expect(row?.kind).toBe("marketing");
    });
});
