import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, reacherMock } = vi.hoisted(() => ({
    queriesMock: {
        findFreshValidations: vi.fn().mockResolvedValue(new Map()),
        upsertValidation: vi.fn().mockResolvedValue(undefined),
    },
    reacherMock: {
        isReacherConfigured: vi.fn().mockReturnValue(true),
        checkEmail: vi.fn(),
    },
}));

vi.mock("@/db/queries/email-validations", () => queriesMock);
vi.mock("@/lib/email/reacher", () => reacherMock);

import { validateAudience } from "@/lib/email/validate-audience";

async function* recipients(emails: string[]) {
    for (const email of emails) yield { email };
}

describe("validateAudience", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queriesMock.findFreshValidations.mockResolvedValue(new Map());
        reacherMock.isReacherConfigured.mockReturnValue(true);
    });

    it("waits for every probe -- including duplicate recipient emails -- before returning", async () => {
        // Two distinct probes for the SAME email, each resolving on a
        // different tick, so a premature-drain bug (map key collision)
        // would return before the slower one finishes.
        let call = 0;
        reacherMock.checkEmail.mockImplementation(async (email: string) => {
            call += 1;
            const thisCall = call;
            // Second call for the duplicate resolves after the first.
            await new Promise((resolve) =>
                setTimeout(resolve, thisCall === 1 ? 0 : 10),
            );
            return {
                email,
                reachable: "safe",
                isDisposable: false,
                isRoleAccount: false,
                hasFullInbox: false,
                isCatchAll: false,
                mxAccepts: true,
                raw: {},
            };
        });

        const summary = await validateAudience({
            slug: "dup-test",
            audience: () => recipients(["dup@example.com", "dup@example.com"]),
        } as never);

        expect(summary.checked).toBe(2);
        expect(reacherMock.checkEmail).toHaveBeenCalledTimes(2);
        expect(queriesMock.upsertValidation).toHaveBeenCalledTimes(2);
    });
});
