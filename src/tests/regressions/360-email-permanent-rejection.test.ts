import { beforeEach, describe, expect, it, vi } from "vitest";

const { emailLogMock, suppressionsMock, renderMock, smtpMock, nodemailerMock } =
    vi.hoisted(() => {
        const suppressed = new Map<string, { reason: string; note?: string }>();
        return {
            emailLogMock: {
                claimEmailSend: vi.fn(),
                releaseEmailSend: vi.fn(),
            },
            suppressionsMock: {
                suppressed,
                findBouncedEmails: vi.fn(
                    async (emails: readonly string[]) =>
                        new Set(
                            emails
                                .map((e) => e.toLowerCase())
                                .filter(
                                    (e) =>
                                        suppressed.get(e)?.reason === "bounce",
                                ),
                        ),
                ),
                recordBounce: vi.fn(async (email: string, note: string) => {
                    const key = email.toLowerCase();
                    const existing = suppressed.get(key);
                    if (!existing) {
                        suppressed.set(key, { reason: "bounce", note });
                    } else if (existing.reason === "bounce") {
                        suppressed.set(key, { reason: "bounce", note });
                    }
                }),
                clearBouncedEmail: vi.fn(async (email: string) => {
                    const key = email.toLowerCase();
                    if (suppressed.get(key)?.reason === "bounce") {
                        suppressed.delete(key);
                    }
                }),
            },
            renderMock: {
                renderEmailHtml: vi.fn().mockResolvedValue("<html></html>"),
            },
            smtpMock: { isSmtpConfigured: vi.fn().mockReturnValue(true) },
            nodemailerMock: { sendMail: vi.fn() },
        };
    });

vi.mock("@/db/queries/email-log", () => emailLogMock);
vi.mock("@/db/queries/email-suppressions", () => suppressionsMock);
vi.mock("@/lib/notifications/render-email", () => renderMock);
vi.mock("@/lib/smtp", () => smtpMock);
vi.mock("@/lib/env", () => ({
    env: {
        SMTP_FROM: null,
        SMTP_USER: null,
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_PASSWORD: "secret",
    },
}));
vi.mock("nodemailer", () => ({
    default: {
        createTransport: vi.fn().mockReturnValue(nodemailerMock),
    },
}));

import {
    sendEmail,
    sendEmailChangeConfirm,
    sendEmailWithError,
    sendOverCapEmail,
    sendPasswordResetEmail,
    sendVerifyEmail,
} from "@/lib/notifications/email";

const ADDRESS = "blocked@example.com";
const SMTP_RESPONSE =
    "550-Your recipient address has been blocked by admins\n550 Contact the postmaster";

function rcptRejection(responseCode: number, response: string) {
    const rejection = {
        code: "EENVELOPE",
        command: "RCPT TO",
        responseCode,
        response,
        recipient: ADDRESS,
    };
    return Object.assign(
        new Error(
            `Can't send mail - all recipients were rejected: ${response}`,
        ),
        {
            ...rejection,
            rejected: [ADDRESS],
            rejectedErrors: [rejection],
        },
    );
}

function connectionRefused() {
    return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:587"), {
        code: "ECONNREFUSED",
        command: "CONN",
    });
}

const message = (to: string = ADDRESS) => ({
    to,
    subject: "Subject",
    html: "<p>Body</p>",
});

function loggedText(): string {
    return [
        ...vi.mocked(console.error).mock.calls,
        ...vi.mocked(console.warn).mock.calls,
    ]
        .map((call) => call.map(String).join(" "))
        .join("\n");
}

const overCapInput = {
    userId: "u1",
    email: ADDRESS,
    billingUrl: "https://app/billing",
    settingsUrl: "https://app/settings",
    currentBytes: 2,
    limitBytes: 1,
};

describe("#360 permanent SMTP rejection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        suppressionsMock.suppressed.clear();
        suppressionsMock.clearBouncedEmail.mockClear();
        smtpMock.isSmtpConfigured.mockReturnValue(true);
        renderMock.renderEmailHtml.mockResolvedValue("<html></html>");
        nodemailerMock.sendMail.mockReset();
        emailLogMock.claimEmailSend.mockResolvedValue(true);
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("suppresses the address on a 550 and does not hit SMTP on the next send", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(550, SMTP_RESPONSE),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).toHaveBeenCalledWith(
            ADDRESS,
            SMTP_RESPONSE,
        );
        expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);

        expect(await sendEmail(message())).toBe(false);
        expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
    });

    it("matches suppressed addresses case-insensitively", async () => {
        suppressionsMock.suppressed.set(ADDRESS, { reason: "bounce" });

        expect(await sendEmail(message("Blocked@Example.COM"))).toBe(false);
        expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
    });

    it("does not put the full address in the lines it adds", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(550, SMTP_RESPONSE),
        );
        await sendEmail(message());
        await sendEmail(message());

        const warnings = vi
            .mocked(console.warn)
            .mock.calls.map((call) => call.join(" "));
        expect(warnings.length).toBeGreaterThanOrEqual(2);
        for (const line of warnings) {
            expect(line).not.toContain(ADDRESS);
            expect(line).toContain("b***@example.com");
        }
    });

    it("still sends to an address that only unsubscribed from campaigns", async () => {
        suppressionsMock.suppressed.set(ADDRESS, { reason: "unsubscribe" });
        nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: "m1" });

        expect(await sendEmail(message())).toBe(true);
        expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
    });

    it("does not suppress on a 4xx rejection", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(451, "451 Try again later"),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).not.toHaveBeenCalled();

        nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: "m1" });
        expect(await sendEmail(message())).toBe(true);
        expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(2);
    });

    it("does not suppress on a connection error", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(connectionRefused());

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).not.toHaveBeenCalled();
    });

    it("returns the permanent failure even if persisting the suppression fails", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(550, SMTP_RESPONSE),
        );
        suppressionsMock.recordBounce.mockRejectedValueOnce(
            new Error(`insert failed, params: ${ADDRESS}`, {
                cause: Object.assign(new Error("connection terminated"), {
                    code: "57P01",
                }),
            }),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
        expect(loggedText()).not.toContain(ADDRESS);
        expect(loggedText()).toContain("57P01");
    });

    it.each([
        [
            "a rejected sender",
            "553 5.7.1 <noreply@x>: Sender address rejected: not owned by user",
            553,
        ],
        ["a relay denial", "554 5.7.1 Relay access denied", 554],
        ["relaying not allowed", "554 5.7.1 Relaying not allowed", 554],
    ])("does not suppress on %s", async (_label, response, responseCode) => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(responseCode, response),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).not.toHaveBeenCalled();
        expect(suppressionsMock.suppressed.has(ADDRESS)).toBe(false);

        nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: "m1" });
        expect(await sendEmail(message())).toBe(true);
        expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(2);
    });

    it("suppresses a 550 whose only 'sender' is inside an address", async () => {
        const response =
            "550 5.1.1 <sender@example.com>: Recipient address rejected: User unknown";
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(550, response),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).toHaveBeenCalledWith(
            ADDRESS,
            response,
        );
        expect(suppressionsMock.suppressed.get(ADDRESS)?.reason).toBe("bounce");
    });

    it("suppresses a 550 that names a relay-like address without angle brackets", async () => {
        const response =
            "550 5.1.1 relay@example.com Recipient address rejected: User unknown";
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(550, response),
        );

        expect(await sendEmail(message())).toBe(false);
        expect(suppressionsMock.recordBounce).toHaveBeenCalledTimes(1);
    });

    describe("an address with a campaign suppression", () => {
        beforeEach(() => {
            suppressionsMock.suppressed.set(ADDRESS, {
                reason: "unsubscribe",
                note: "list-unsubscribe",
            });
        });

        it("keeps its reason and note after a 550", async () => {
            nodemailerMock.sendMail.mockRejectedValueOnce(
                rcptRejection(550, SMTP_RESPONSE),
            );

            expect(await sendEmail(message())).toBe(false);
            expect(suppressionsMock.recordBounce).toHaveBeenCalledTimes(1);
            expect(suppressionsMock.suppressed.get(ADDRESS)).toEqual({
                reason: "unsubscribe",
                note: "list-unsubscribe",
            });
        });

        it("is not deleted by a later successful bypass send", async () => {
            nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: "m1" });

            expect(
                await sendPasswordResetEmail(ADDRESS, "https://app/reset"),
            ).toBe(true);
            expect(suppressionsMock.clearBouncedEmail).toHaveBeenCalledWith(
                ADDRESS,
            );
            expect(suppressionsMock.suppressed.get(ADDRESS)?.reason).toBe(
                "unsubscribe",
            );
        });

        it("keeps the claim after a 550 so the retry loop stops", async () => {
            nodemailerMock.sendMail.mockRejectedValueOnce(
                rcptRejection(550, SMTP_RESPONSE),
            );

            expect(await sendOverCapEmail(overCapInput)).toBe(false);
            expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
            expect(suppressionsMock.suppressed.get(ADDRESS)?.reason).toBe(
                "unsubscribe",
            );
        });
    });

    it("releases the claim after a sender rejection", async () => {
        nodemailerMock.sendMail.mockRejectedValueOnce(
            rcptRejection(
                553,
                "553 5.7.1 <noreply@x>: Sender address rejected: not owned by user",
            ),
        );

        expect(await sendOverCapEmail(overCapInput)).toBe(false);
        expect(emailLogMock.releaseEmailSend).toHaveBeenCalledTimes(1);
    });

    describe("suppression lookup failure", () => {
        beforeEach(() => {
            suppressionsMock.findBouncedEmails.mockRejectedValueOnce(
                new Error(`select failed, params: ${ADDRESS}`, {
                    cause: Object.assign(new Error("timeout"), {
                        code: "ETIMEDOUT",
                    }),
                }),
            );
        });

        it("returns false without sending and without logging the address", async () => {
            expect(await sendEmail(message())).toBe(false);
            expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
            expect(loggedText()).not.toContain(ADDRESS);
            expect(loggedText()).toContain(
                "Email suppression lookup failed: ETIMEDOUT",
            );
        });

        it("releases a claim", async () => {
            expect(await sendOverCapEmail(overCapInput)).toBe(false);
            expect(emailLogMock.releaseEmailSend).toHaveBeenCalledWith({
                userId: "u1",
                kind: "over_cap",
            });
            expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
        });
    });

    describe("clearing a bounce after a successful send", () => {
        beforeEach(() => {
            suppressionsMock.suppressed.set(ADDRESS, { reason: "bounce" });
            nodemailerMock.sendMail.mockResolvedValue({ messageId: "m1" });
        });

        it("clears it after a successful sendEmailWithError", async () => {
            await sendEmailWithError(message());
            expect(suppressionsMock.clearBouncedEmail).toHaveBeenCalledWith(
                ADDRESS,
            );
            expect(suppressionsMock.suppressed.has(ADDRESS)).toBe(false);
        });

        it("does not clear it when sendEmailWithError fails", async () => {
            nodemailerMock.sendMail.mockReset();
            nodemailerMock.sendMail.mockRejectedValueOnce(connectionRefused());
            await expect(sendEmailWithError(message())).rejects.toThrow();
            expect(suppressionsMock.clearBouncedEmail).not.toHaveBeenCalled();
            expect(suppressionsMock.suppressed.has(ADDRESS)).toBe(true);
        });

        it("clears it after a successful bypass send", async () => {
            expect(
                await sendPasswordResetEmail(ADDRESS, "https://app/reset"),
            ).toBe(true);
            expect(suppressionsMock.suppressed.has(ADDRESS)).toBe(false);
        });

        it("does not clear it after an ordinary send that was suppressed", async () => {
            expect(await sendEmail(message())).toBe(false);
            expect(suppressionsMock.clearBouncedEmail).not.toHaveBeenCalled();
        });

        it("still succeeds and logs only the code when clearing fails", async () => {
            suppressionsMock.clearBouncedEmail.mockRejectedValueOnce(
                new Error(`delete failed, params: ${ADDRESS}`, {
                    cause: Object.assign(new Error("down"), {
                        code: "57P01",
                    }),
                }),
            );

            await sendEmailWithError(message());
            expect(loggedText()).not.toContain(ADDRESS);
            expect(loggedText()).toContain(
                "Failed to clear bounce suppression: 57P01",
            );
        });
    });

    describe("sendClaimedEmail (via sendOverCapEmail)", () => {
        it("keeps the claim after a permanent failure", async () => {
            nodemailerMock.sendMail.mockRejectedValueOnce(
                rcptRejection(550, SMTP_RESPONSE),
            );

            expect(await sendOverCapEmail(overCapInput)).toBe(false);
            expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
        });

        it("keeps the claim when the recipient is already suppressed", async () => {
            suppressionsMock.suppressed.set(ADDRESS, { reason: "bounce" });

            expect(await sendOverCapEmail(overCapInput)).toBe(false);
            expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
            expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
        });

        it.each([
            ["ECONNREFUSED", connectionRefused()],
            [
                "a 421 rejection",
                rcptRejection(421, "421 Service not available"),
            ],
        ])("releases the claim after a transient failure (%s)", async (_label, error) => {
            nodemailerMock.sendMail.mockRejectedValueOnce(error);

            expect(await sendOverCapEmail(overCapInput)).toBe(false);
            expect(emailLogMock.releaseEmailSend).toHaveBeenCalledWith({
                userId: "u1",
                kind: "over_cap",
            });
        });

        it("keeps the claim after a successful send", async () => {
            nodemailerMock.sendMail.mockResolvedValueOnce({ messageId: "m1" });

            expect(await sendOverCapEmail(overCapInput)).toBe(true);
            expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
        });
    });

    describe("account-recovery mail bypasses suppression", () => {
        beforeEach(() => {
            suppressionsMock.suppressed.set(ADDRESS, { reason: "bounce" });
            nodemailerMock.sendMail.mockResolvedValue({ messageId: "m1" });
        });

        it("sends a password reset", async () => {
            expect(
                await sendPasswordResetEmail(ADDRESS, "https://app/reset"),
            ).toBe(true);
            expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
        });

        it("sends an email verification", async () => {
            expect(
                await sendVerifyEmail({
                    email: ADDRESS,
                    verificationUrl: "https://app/verify",
                    expiresInSeconds: 86400,
                }),
            ).toBe(true);
            expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
        });

        it("sends an email-change confirmation", async () => {
            expect(
                await sendEmailChangeConfirm({
                    sendTo: ADDRESS,
                    newEmail: "new@example.com",
                    confirmUrl: "https://app/confirm",
                    expiresInSeconds: 86400,
                }),
            ).toBe(true);
            expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
        });

        it("still skips a suppressed address for ordinary mail", async () => {
            expect(await sendEmail(message())).toBe(false);
            expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
        });
    });
});
