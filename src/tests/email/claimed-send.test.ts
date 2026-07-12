import { beforeEach, describe, expect, it, vi } from "vitest";

const { emailLogMock, renderMock, smtpMock, nodemailerMock } = vi.hoisted(
    () => ({
        emailLogMock: {
            claimEmailSend: vi.fn(),
            releaseEmailSend: vi.fn(),
        },
        renderMock: { render: vi.fn().mockResolvedValue("<html></html>") },
        smtpMock: { isSmtpConfigured: vi.fn().mockReturnValue(false) },
        nodemailerMock: {
            sendMail: vi.fn().mockResolvedValue({ messageId: "m1" }),
        },
    }),
);

vi.mock("@/db/queries/email-log", () => emailLogMock);
vi.mock("@react-email/render", () => renderMock);
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

import { sendWelcomeHostedProEmail } from "@/lib/notifications/email";

describe("sendClaimedEmail (via sendWelcomeHostedProEmail)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        renderMock.render.mockResolvedValue("<html></html>");
    });

    const input = {
        userId: "u1",
        email: "u1@example.com",
        dashboardUrl: "https://app/dashboard",
        settingsUrl: "https://app/settings",
        foundingMember: false,
        amountValue: "5.00",
        amountCurrency: "USD",
        interval: "month" as const,
    };

    it("does not send (and claims nothing further) when the kind is already claimed", async () => {
        emailLogMock.claimEmailSend.mockResolvedValue(false);
        const sent = await sendWelcomeHostedProEmail(input);
        expect(sent).toBe(false);
        expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
    });

    it("releases the claim when sendEmail fails (SMTP not configured) so a retry can claim again", async () => {
        emailLogMock.claimEmailSend.mockResolvedValue(true);
        smtpMock.isSmtpConfigured.mockReturnValue(false);

        const sent = await sendWelcomeHostedProEmail(input);

        expect(sent).toBe(false);
        expect(emailLogMock.releaseEmailSend).toHaveBeenCalledWith({
            userId: "u1",
            kind: "welcome_hosted_pro",
        });
    });

    it("releases the claim and rethrows when rendering the template throws", async () => {
        emailLogMock.claimEmailSend.mockResolvedValue(true);
        renderMock.render.mockRejectedValue(new Error("render exploded"));

        await expect(sendWelcomeHostedProEmail(input)).rejects.toThrow(
            "render exploded",
        );
        expect(emailLogMock.releaseEmailSend).toHaveBeenCalledWith({
            userId: "u1",
            kind: "welcome_hosted_pro",
        });
    });

    it("does not release the claim on a successful send", async () => {
        emailLogMock.claimEmailSend.mockResolvedValue(true);
        smtpMock.isSmtpConfigured.mockReturnValue(true);
        nodemailerMock.sendMail.mockResolvedValue({ messageId: "m1" });

        const sent = await sendWelcomeHostedProEmail(input);

        expect(sent).toBe(true);
        expect(emailLogMock.releaseEmailSend).not.toHaveBeenCalled();
    });
});
