import { render } from "@react-email/render";
import { type NextRequest, NextResponse } from "next/server";
import React from "react";
import { z } from "zod";
import { upsertSubscriber } from "@/db/queries/newsletter-subscriptions";
import {
    htmlToText,
    resolveFromAddress,
    SmtpNotConfiguredError,
    sendEmailWithHeaders,
} from "@/lib/email/transport";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { env } from "@/lib/env";
import { NewsletterConfirmEmail } from "@/lib/notifications/email-templates/newsletter-confirm-email";
import { consumeRateLimitBucket, getClientIp } from "@/lib/rate-limit";

const subscribeSchema = z.object({
    email: z
        .string()
        .email("Please enter a valid email address")
        .max(320, "Email address is too long"),
    company: z.string().optional(),
    source: z
        .union([z.literal("landing"), z.literal("install"), z.literal("admin")])
        .optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(req);
    const limit = await consumeRateLimitBucket(`newsletter:subscribe:${ip}`, {
        limit: 5,
        windowMs: 60_000,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            { error: "Too many requests. Please try again in a minute." },
            { status: 429 },
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid input" },
            { status: 400 },
        );
    }

    if (parsed.data.company && parsed.data.company.trim() !== "") {
        return NextResponse.json({ ok: true });
    }

    const subscriber = await upsertSubscriber({
        email: parsed.data.email,
        source: parsed.data.source ?? "landing",
    });

    if (subscriber.confirmedAt) {
        return NextResponse.json({ ok: true });
    }

    try {
        await sendConfirmation(subscriber.id, subscriber.email);
    } catch (error) {
        if (error instanceof SmtpNotConfiguredError) {
            // Expected on self-host instances without SMTP configured --
            // the subscriber row still exists and will get their
            // confirmation email once SMTP is set up. Not a failure.
            console.warn(
                "[newsletter] SMTP not configured; confirmation email skipped",
            );
            return NextResponse.json({ ok: true });
        }
        // Any other failure (render exception, transient SMTP error) means
        // the user will never see a confirm link. Surface it as a 5xx
        // instead of silently returning ok:true so the client can show an
        // error and the user knows to retry.
        console.error("[newsletter] failed to send confirmation email", error);
        return NextResponse.json(
            { error: "Failed to send confirmation email. Please try again." },
            { status: 502 },
        );
    }

    return NextResponse.json({ ok: true });
}

async function sendConfirmation(
    subscriberId: string,
    email: string,
): Promise<void> {
    const base = env.APP_URL?.replace(/\/$/, "");
    if (!base) {
        throw new Error(
            "newsletter/subscribe: APP_URL is not configured; cannot build confirmation URL",
        );
    }
    const token = signUnsubscribeToken("subscriber", subscriberId);
    const confirmUrl = `${base}/api/newsletter/confirm?s=${encodeURIComponent(subscriberId)}&t=${encodeURIComponent(token)}`;

    const html = await render(
        React.createElement(NewsletterConfirmEmail, { confirmUrl }),
        { pretty: false },
    );
    const text = `Confirm your Riffado newsletter subscription by visiting:\n\n${confirmUrl}\n\nIf you didn't sign up, ignore this email -- without confirmation we'll never email this address again.`;

    await sendEmailWithHeaders({
        to: email,
        from: resolveFromAddress("transactional"),
        subject: "Confirm your Riffado newsletter subscription",
        html,
        text: htmlToText(text === "" ? html : text),
    });
}
