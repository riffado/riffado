import { beforeEach, describe, expect, it, vi } from "vitest";

const { enforcementMock, emailMock, dbMock, envMock } = vi.hoisted(() => ({
    enforcementMock: { canStoreMoreBytes: vi.fn() },
    emailMock: { sendOverCapEmail: vi.fn() },
    dbMock: { select: vi.fn() },
    envMock: { APP_URL: "https://riffado.test" },
}));

vi.mock("@/lib/hosted/billing/enforcement", () => enforcementMock);
vi.mock("@/lib/notifications/email", () => emailMock);
vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/db/schema", () => ({ users: { id: "id", email: "email" } }));

import { enforceStorageCap } from "@/lib/hosted/billing/storage-cap";

function stubUserEmail(email: string | null) {
    dbMock.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi
                    .fn()
                    .mockResolvedValue(email ? [{ email }] : []),
            }),
        }),
    });
}

describe("enforceStorageCap", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("allows and sends no email on self-host (null cap)", async () => {
        enforcementMock.canStoreMoreBytes.mockResolvedValue({
            allowed: true,
            currentBytes: 0,
            limitBytes: null,
        });
        const result = await enforceStorageCap({
            userId: "u1",
            additionalBytes: 1024,
        });
        expect(result.allowed).toBe(true);
        expect(emailMock.sendOverCapEmail).not.toHaveBeenCalled();
    });

    it("allows under cap without emailing", async () => {
        enforcementMock.canStoreMoreBytes.mockResolvedValue({
            allowed: true,
            currentBytes: 1_000,
            limitBytes: 5_000,
        });
        const result = await enforceStorageCap({
            userId: "u1",
            additionalBytes: 100,
        });
        expect(result.allowed).toBe(true);
        expect(emailMock.sendOverCapEmail).not.toHaveBeenCalled();
    });

    it("blocks over cap and fires the over-cap email", async () => {
        enforcementMock.canStoreMoreBytes.mockResolvedValue({
            allowed: false,
            currentBytes: 4_900,
            limitBytes: 5_000,
        });
        stubUserEmail("user@riffado.test");

        const result = await enforceStorageCap({
            userId: "u1",
            additionalBytes: 500,
        });

        expect(result.allowed).toBe(false);
        expect(emailMock.sendOverCapEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "u1",
                email: "user@riffado.test",
                currentBytes: 4_900,
                limitBytes: 5_000,
            }),
        );
    });

    it("still blocks when the user has no email on file", async () => {
        enforcementMock.canStoreMoreBytes.mockResolvedValue({
            allowed: false,
            currentBytes: 4_900,
            limitBytes: 5_000,
        });
        stubUserEmail(null);

        const result = await enforceStorageCap({
            userId: "u1",
            additionalBytes: 500,
        });

        expect(result.allowed).toBe(false);
        expect(emailMock.sendOverCapEmail).not.toHaveBeenCalled();
    });
});
