import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import React from "react";
import { claimEmailSend, releaseEmailSend } from "@/db/queries/email-log";
import { env } from "@/lib/env";
import { isSmtpConfigured } from "@/lib/smtp";
import { AccountDeletedEmail } from "./email-templates/account-deleted";
import { EmailChangeConfirmEmail } from "./email-templates/email-change-confirm";
import { ExportReadyEmail } from "./email-templates/export-ready";
import { GraceLastDayEmail } from "./email-templates/grace-last-day";
import { GraceReminderEmail } from "./email-templates/grace-reminder";
import { GraceStartedEmail } from "./email-templates/grace-started";
import { NewRecordingEmail } from "./email-templates/new-recording-email";
import { OverCapEmail } from "./email-templates/over-cap";
import { PasswordResetEmail } from "./email-templates/password-reset-email";
import { PaymentFailedEmail } from "./email-templates/payment-failed";
import { TestEmail } from "./email-templates/test-email";
import { TransitionEndedEmail } from "./email-templates/transition-ended";
import { TransitionReminderEmail } from "./email-templates/transition-reminder";
import { TransitionStartEmail } from "./email-templates/transition-start";
import { VerifyEmailEmail } from "./email-templates/verify-email";
import { WelcomeHostedProEmail } from "./email-templates/welcome-hosted-pro";

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
    // Return null if SMTP is not configured
    if (!isSmtpConfigured()) {
        return null;
    }

    // Create transporter if it doesn't exist
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
            secure: env.SMTP_SECURE ?? false,
            auth: {
                user: env.SMTP_USER,
                pass: env.SMTP_PASSWORD,
            },
        });
    }

    return transporter;
}

/**
 * Send an email notification using SMTP
 * @returns true if successful, false otherwise
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
    try {
        const mailer = getTransporter();

        if (!mailer) {
            console.warn(
                "Email notification skipped: SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.",
            );
            return false;
        }

        const fromEmail =
            env.SMTP_FROM || env.SMTP_USER || "noreply@riffado.com";

        await mailer.sendMail({
            from: fromEmail,
            to: options.to,
            replyTo: env.SMTP_REPLY_TO,
            subject: options.subject,
            html: options.html,
            text: options.text || options.html.replace(/<[^>]*>/g, ""), // Strip HTML if no text provided
        });

        return true;
    } catch (error) {
        console.error("Failed to send email:", error);
        return false;
    }
}

/**
 * Send an email notification using SMTP and throw errors with details
 * @throws Error with detailed message if sending fails
 */
export async function sendEmailWithError(options: EmailOptions): Promise<void> {
    const mailer = getTransporter();

    if (!mailer) {
        throw new Error(
            "SMTP not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.",
        );
    }

    const fromEmail = env.SMTP_FROM || env.SMTP_USER || "noreply@riffado.com";

    try {
        await mailer.sendMail({
            from: fromEmail,
            to: options.to,
            replyTo: env.SMTP_REPLY_TO,
            subject: options.subject,
            html: options.html,
            text: options.text || options.html.replace(/<[^>]*>/g, ""),
        });
    } catch (error) {
        const err = error as Error & { code?: string; command?: string };
        let errorMessage = "Failed to send email";

        if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") {
            if (err.command === "CONN") {
                errorMessage = `Cannot connect to SMTP server at ${env.SMTP_HOST}:${env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587)}. Please check your SMTP_HOST and SMTP_PORT settings.`;
            } else {
                errorMessage = `Connection timeout to SMTP server. Please verify your SMTP_HOST and SMTP_PORT are correct.`;
            }
        } else if (err.code === "EAUTH") {
            errorMessage =
                "SMTP authentication failed. Please check your SMTP_USER and SMTP_PASSWORD.";
        } else if (err.message) {
            errorMessage = `SMTP error: ${err.message}`;
        }

        throw new Error(errorMessage);
    }
}

/**
 * Claim a once-only `(userId, kind)` email slot, build + send it, and
 * release the claim if the send fails (transient SMTP error) or `build`
 * throws (e.g. a render exception). Without the release, a single
 * transient failure permanently drops that email -- the claim row
 * already exists, so every future retry sees `claimed: false` and
 * skips sending forever.
 */
async function sendClaimedEmail(
    claim: { userId: string; kind: string },
    build: () => Promise<EmailOptions>,
): Promise<boolean> {
    const claimed = await claimEmailSend(claim);
    if (!claimed) return false;
    try {
        const options = await build();
        const sent = await sendEmail(options);
        if (!sent) await releaseEmailSend(claim);
        return sent;
    } catch (error) {
        await releaseEmailSend(claim);
        throw error;
    }
}

export async function sendNewRecordingEmail(
    email: string,
    count: number,
    recordingNames?: string[],
): Promise<boolean> {
    const subject =
        count === 1 ? "New recording synced" : `${count} new recordings synced`;

    const baseUrl = env.APP_URL;
    const dashboardUrl = `${baseUrl}/dashboard`;
    const settingsUrl = `${baseUrl}/settings#notifications`;

    // Render React email component to HTML
    // `pretty: false` skips @react-email/render's prettier formatting
    // pass. Recipients never see source HTML, and avoiding prettier keeps
    // it out of the runtime require graph (Next 16 flags it as an
    // unresolved external otherwise).
    const html = await render(
        React.createElement(NewRecordingEmail, {
            count,
            recordingNames: recordingNames || [],
            dashboardUrl,
            settingsUrl,
        }),
        { pretty: false },
    );

    // Generate plain text version
    const text = `
${subject}

Your Plaud device has synced ${count === 1 ? "a new recording" : `${count} new recordings`}.
${
    recordingNames && recordingNames.length > 0
        ? `\nRecordings:\n${recordingNames.map((name) => `- ${name}`).join("\n")}`
        : ""
}

View recordings: ${dashboardUrl}

Manage notifications: ${settingsUrl}
    `.trim();

    return sendEmail({
        to: email,
        subject,
        html,
        text,
    });
}

export async function sendPasswordResetEmail(
    email: string,
    resetUrl: string,
): Promise<boolean> {
    const subject = "Reset your Riffado password";

    const html = await render(
        React.createElement(PasswordResetEmail, {
            resetUrl,
        }),
        { pretty: false },
    );

    const text = `
${subject}

We received a request to reset your Riffado password. Click the link below to choose a new password. This link expires in 1 hour.

${resetUrl}

If you didn't request a password reset, you can safely ignore this email -- your password will not change.
    `.trim();

    return sendEmail({
        to: email,
        subject,
        html,
        text,
    });
}

/**
 * Once-only welcome email after a successful first payment. The
 * `welcome_hosted_pro` email_log row is claimed first; if it already
 * exists (e.g. webhook redelivery), the send is skipped.
 */
export async function sendWelcomeHostedProEmail(input: {
    userId: string;
    email: string;
    dashboardUrl: string;
    settingsUrl: string;
    foundingMember: boolean;
    /** 1-indexed founding-member rank. Omit/null when not resolvable. */
    foundingRank?: number | null;
    foundingCapacity?: number;
    amountValue: string;
    amountCurrency: string;
    interval: "month" | "year";
    /** Recordings synced before this upgrade, for personalized copy. */
    recordingCount?: number;
    totalDurationMs?: number;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: "welcome_hosted_pro" },
        async () => {
            const html = await render(
                React.createElement(WelcomeHostedProEmail, {
                    dashboardUrl: input.dashboardUrl,
                    settingsUrl: input.settingsUrl,
                    foundingMember: input.foundingMember,
                    foundingRank: input.foundingRank ?? null,
                    foundingCapacity: input.foundingCapacity ?? 0,
                    amountValue: input.amountValue,
                    amountCurrency: input.amountCurrency,
                    interval: input.interval,
                    recordingCount: input.recordingCount ?? 0,
                    totalDurationMs: input.totalDurationMs ?? 0,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "You're on Riffado Hosted Pro",
                html,
            };
        },
    );
}

/**
 * Payment-failed nudge. Per-failure, not once-only: kind is namespaced
 * with the payment id so each failed payment can send exactly once.
 */
export async function sendPaymentFailedEmail(input: {
    userId: string;
    email: string;
    paymentId: string;
    billingUrl: string;
    nextRetryAt: Date | null;
    accessUntil: Date | null;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: `payment_failed:${input.paymentId}` },
        async () => {
            const html = await render(
                React.createElement(PaymentFailedEmail, {
                    billingUrl: input.billingUrl,
                    nextRetryAt: input.nextRetryAt,
                    accessUntil: input.accessUntil,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "Riffado: payment failed",
                html,
            };
        },
    );
}

/**
 * Over-cap notice. Once-only per user; if the user dips back under
 * and crosses again later, the operator manually clears the email_log
 * row (or we ship a smarter "over-cap-cycle" key later).
 */
export async function sendOverCapEmail(input: {
    userId: string;
    email: string;
    billingUrl: string;
    settingsUrl: string;
    currentBytes: number;
    limitBytes: number;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: "over_cap" },
        async () => {
            const html = await render(
                React.createElement(OverCapEmail, {
                    billingUrl: input.billingUrl,
                    settingsUrl: input.settingsUrl,
                    currentBytes: input.currentBytes,
                    limitBytes: input.limitBytes,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "Riffado: storage over the Free cap",
                html,
            };
        },
    );
}

/**
 * Send a verification email. Called from the Better Auth
 * `emailVerification.sendVerificationEmail` callback on sign-up and
 * on explicit "resend verification" requests.
 */
export async function sendVerifyEmail(input: {
    email: string;
    verificationUrl: string;
    expiresInSeconds: number;
}): Promise<boolean> {
    const expiresInHours = Math.max(
        1,
        Math.round(input.expiresInSeconds / 3600),
    );
    const html = await render(
        React.createElement(VerifyEmailEmail, {
            verificationUrl: input.verificationUrl,
            expiresInHours,
        }),
        { pretty: false },
    );
    return sendEmail({
        to: input.email,
        subject: "Confirm your Riffado email",
        html,
    });
}

/**
 * Send the confirmation link for an email-address change. Called from
 * the Better Auth `user.changeEmail.sendChangeEmailVerification`
 * callback. Sent to the OLD address per Better Auth defaults so the
 * change can be canceled if the account was compromised.
 */
export async function sendEmailChangeConfirm(input: {
    /** Address the link is mailed to (the current address on file). */
    sendTo: string;
    newEmail: string;
    confirmUrl: string;
    expiresInSeconds: number;
}): Promise<boolean> {
    const expiresInHours = Math.max(
        1,
        Math.round(input.expiresInSeconds / 3600),
    );
    const html = await render(
        React.createElement(EmailChangeConfirmEmail, {
            confirmUrl: input.confirmUrl,
            newEmail: input.newEmail,
            expiresInHours,
        }),
        { pretty: false },
    );
    return sendEmail({
        to: input.sendTo,
        subject: "Confirm your new Riffado email",
        html,
    });
}

/**
 * Grace-started notice. Dedup key includes the deletion timestamp so a
 * user who reactivates and lapses again gets a fresh send.
 */
export async function sendGraceStartedEmail(input: {
    userId: string;
    email: string;
    gracePath: "trial" | "paid";
    graceDays: number;
    /** Configured trial length in days (`BILLING_TRIAL_DAYS`). Only shown when `gracePath === "trial"`. */
    trialDays: number;
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        {
            userId: input.userId,
            kind: `grace_started:${input.deletionAt.toISOString()}`,
        },
        async () => {
            const html = await render(
                React.createElement(GraceStartedEmail, {
                    gracePath: input.gracePath,
                    graceDays: input.graceDays,
                    trialDays: input.trialDays,
                    deletionAt: input.deletionAt,
                    exportUrl: input.exportUrl,
                    reactivateUrl: input.reactivateUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject:
                    input.gracePath === "trial"
                        ? `Your Riffado trial ended: ${input.graceDays} days to export`
                        : `Your Riffado subscription ended: ${input.graceDays} days to export`,
                html,
            };
        },
    );
}

/** Sent once per completed export job (dedup keyed on jobId). */
export async function sendExportReadyEmail(input: {
    userId: string;
    email: string;
    jobId: string;
    downloadUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: `export_ready:${input.jobId}` },
        async () => {
            const html = await render(
                React.createElement(ExportReadyEmail, {
                    downloadUrl: input.downloadUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "Your Riffado export is ready",
                html,
            };
        },
    );
}

/** Mid-grace reminder. Dedup includes deletionAt + the daysLeft mark. */
export async function sendGraceReminderEmail(input: {
    userId: string;
    email: string;
    daysLeft: number;
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        {
            userId: input.userId,
            kind: `grace_reminder:${input.deletionAt.toISOString()}:${input.daysLeft}`,
        },
        async () => {
            const html = await render(
                React.createElement(GraceReminderEmail, {
                    daysLeft: input.daysLeft,
                    deletionAt: input.deletionAt,
                    exportUrl: input.exportUrl,
                    reactivateUrl: input.reactivateUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: `Riffado: ${input.daysLeft} days left to export`,
                html,
            };
        },
    );
}

/** Last-day (~24h before deletion) notice. */
export async function sendGraceLastDayEmail(input: {
    userId: string;
    email: string;
    deletionAt: Date;
    exportUrl: string;
    reactivateUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        {
            userId: input.userId,
            kind: `grace_last_day:${input.deletionAt.toISOString()}`,
        },
        async () => {
            const html = await render(
                React.createElement(GraceLastDayEmail, {
                    deletionAt: input.deletionAt,
                    exportUrl: input.exportUrl,
                    reactivateUrl: input.reactivateUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject:
                    "Riffado: last chance to export (account deleted in 24h)",
                html,
            };
        },
    );
}

/**
 * Sent the moment the user row is deleted. Caller MUST capture the
 * email address before the user row is dropped (the email_log row is
 * also FK-cascade-deleted, so dedup of this kind is irrelevant by
 * design -- but we don't claim it for the same reason: no user row, no
 * place to claim against).
 */
export async function sendAccountDeletedEmail(input: {
    email: string;
    signupUrl: string;
}): Promise<boolean> {
    const html = await render(
        React.createElement(AccountDeletedEmail, {
            signupUrl: input.signupUrl,
        }),
        { pretty: false },
    );
    return sendEmail({
        to: input.email,
        subject: "Your Riffado account has been deleted",
        html,
    });
}

/**
 * Launch-day notice to the grandfathered hosted cohort: hosted is now
 * paid, but Pro access stays free through the transition window. Once-only
 * per user (`transition_start`).
 */
export async function sendTransitionStartEmail(input: {
    userId: string;
    email: string;
    transitionEndsAt: Date;
    amountValue: string;
    amountCurrency: string;
    foundingOfferAvailable: boolean;
    foundingCapacity: number;
    billingUrl: string;
    exportUrl: string;
    selfHostUrl: string;
    /** Sponsorship destination. Omit until a real one exists. */
    sponsorUrl?: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: "transition_start" },
        async () => {
            const html = await render(
                React.createElement(TransitionStartEmail, {
                    transitionEndsAt: input.transitionEndsAt,
                    amountValue: input.amountValue,
                    amountCurrency: input.amountCurrency,
                    foundingOfferAvailable: input.foundingOfferAvailable,
                    foundingCapacity: input.foundingCapacity,
                    billingUrl: input.billingUrl,
                    exportUrl: input.exportUrl,
                    selfHostUrl: input.selfHostUrl,
                    sponsorUrl: input.sponsorUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "Why Riffado Hosted Pro is happening",
                html,
            };
        },
    );
}

/**
 * Reminder ~3 days before the transition window closes. Once-only per
 * user (`transition_reminder`).
 */
export async function sendTransitionReminderEmail(input: {
    userId: string;
    email: string;
    daysLeft: number;
    transitionEndsAt: Date;
    amountValue: string;
    amountCurrency: string;
    foundingOfferAvailable: boolean;
    foundingCapacity: number;
    billingUrl: string;
    exportUrl: string;
    selfHostUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: "transition_reminder" },
        async () => {
            const html = await render(
                React.createElement(TransitionReminderEmail, {
                    daysLeft: input.daysLeft,
                    transitionEndsAt: input.transitionEndsAt,
                    amountValue: input.amountValue,
                    amountCurrency: input.amountCurrency,
                    foundingOfferAvailable: input.foundingOfferAvailable,
                    foundingCapacity: input.foundingCapacity,
                    billingUrl: input.billingUrl,
                    exportUrl: input.exportUrl,
                    selfHostUrl: input.selfHostUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: `Riffado: ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"} of free Hosted Pro left`,
                html,
            };
        },
    );
}

/**
 * Sent when the transition window has closed and the grandfathered
 * account is now read-only. No deletion clock. Once-only per user
 * (`transition_ended`).
 */
export async function sendTransitionEndedEmail(input: {
    userId: string;
    email: string;
    amountValue: string;
    amountCurrency: string;
    billingUrl: string;
    exportUrl: string;
    selfHostUrl: string;
}): Promise<boolean> {
    return sendClaimedEmail(
        { userId: input.userId, kind: "transition_ended" },
        async () => {
            const html = await render(
                React.createElement(TransitionEndedEmail, {
                    amountValue: input.amountValue,
                    amountCurrency: input.amountCurrency,
                    billingUrl: input.billingUrl,
                    exportUrl: input.exportUrl,
                    selfHostUrl: input.selfHostUrl,
                }),
                { pretty: false },
            );
            return {
                to: input.email,
                subject: "Your Riffado hosted account is now read-only",
                html,
            };
        },
    );
}

export async function sendTestEmail(email: string): Promise<void> {
    const subject = "Test Email from Riffado";

    const baseUrl = env.APP_URL;
    const dashboardUrl = `${baseUrl}/dashboard`;
    const settingsUrl = `${baseUrl}/settings#notifications`;

    // Render React email component to HTML
    const html = await render(
        React.createElement(TestEmail, {
            dashboardUrl,
            settingsUrl,
        }),
        { pretty: false },
    );

    // Generate plain text version
    const text = `
${subject}

This is a test email from Riffado to verify your email notification settings.

If you received this email, your email notifications are configured correctly! You'll receive notifications when new recordings are synced from your Plaud device.

View dashboard: ${dashboardUrl}

Manage notifications: ${settingsUrl}
    `.trim();

    await sendEmailWithError({
        to: email,
        subject,
        html,
        text,
    });
}
