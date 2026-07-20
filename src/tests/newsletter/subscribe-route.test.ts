import { beforeEach, describe, expect, it, vi } from "vitest";

const { queriesMock, transportMock, tokenMock, rateLimitMock, renderMock } =
    vi.hoisted(() => ({
        queriesMock: { upsertSubscriber: vi.fn() },
        transportMock: {
            sendEmailWithHeaders: vi.fn(),
            resolveFromAddress: vi.fn().mockReturnValue("noreply@riffado.com"),
            htmlToText: vi.fn().mockReturnValue("text"),
            SmtpNotConfiguredError: class SmtpNotConfiguredError extends Error {},
        },
        tokenMock: { signUnsubscribeToken: vi.fn().mockReturnValue("tok") },
        rateLimitMock: {
            getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
            consumeRateLimitBucket: vi
                .fn()
                .mockResolvedValue({ allowed: true }),
        },
        renderMock: {
            renderEmailHtml: vi.fn().mockResolvedValue("<html></html>"),
        },
    }));

vi.mock("@/db/queries/newsletter-subscriptions", () => queriesMock);
vi.mock("@/lib/email/transport", () => transportMock);
vi.mock("@/lib/email/unsubscribe-token", () => tokenMock);
vi.mock("@/lib/rate-limit", () => rateLimitMock);
vi.mock("@/lib/notifications/render-email", () => renderMock);
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://riffado.com" } }));
vi.mock("@/lib/notifications/email-templates/newsletter-confirm-email", () => ({
    NewsletterConfirmEmail: () => null,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/newsletter/subscribe/route";

function request(body: unknown) {
    return new NextRequest("https://riffado.com/api/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/newsletter/subscribe", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rateLimitMock.consumeRateLimitBucket.mockResolvedValue({
            allowed: true,
        });
        queriesMock.upsertSubscriber.mockResolvedValue({
            id: "sub_1",
            email: "user@example.com",
            confirmedAt: null,
        });
    });

    it("returns ok:true when the confirmation email sends successfully", async () => {
        transportMock.sendEmailWithHeaders.mockResolvedValue(undefined);
        const res = await POST(request({ email: "user@example.com" }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });

    it("returns ok:true (not an error) when SMTP is not configured", async () => {
        transportMock.sendEmailWithHeaders.mockRejectedValue(
            new transportMock.SmtpNotConfiguredError("no smtp"),
        );
        const res = await POST(request({ email: "user@example.com" }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });

    it("returns a 5xx when confirmation delivery fails for a real reason", async () => {
        transportMock.sendEmailWithHeaders.mockRejectedValue(
            new Error("SMTP timeout"),
        );
        const res = await POST(request({ email: "user@example.com" }));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.ok).toBeUndefined();
    });

    it("skips sending entirely (still ok:true) for the honeypot-triggered path", async () => {
        const res = await POST(
            request({ email: "user@example.com", company: "Acme" }),
        );
        expect(res.status).toBe(200);
        expect(transportMock.sendEmailWithHeaders).not.toHaveBeenCalled();
    });
});
