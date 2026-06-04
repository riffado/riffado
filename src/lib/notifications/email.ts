import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import React from "react";
import { env } from "@/lib/env";
import { isSmtpConfigured } from "@/lib/smtp";
import { NewRecordingEmail } from "./email-templates/new-recording-email";
import { PasswordResetEmail } from "./email-templates/password-reset-email";
import { TestEmail } from "./email-templates/test-email";

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
            env.SMTP_FROM || env.SMTP_USER || "noreply@mesynx-ai.com";

        await mailer.sendMail({
            from: fromEmail,
            to: options.to,
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

    const fromEmail = env.SMTP_FROM || env.SMTP_USER || "noreply@mesynx-ai.com";

    try {
        await mailer.sendMail({
            from: fromEmail,
            to: options.to,
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
    const subject = "Reset your Mesynx AI password";

    const html = await render(
        React.createElement(PasswordResetEmail, {
            resetUrl,
        }),
        { pretty: false },
    );

    const text = `
${subject}

We received a request to reset your Mesynx AI password. Click the link below to choose a new password. This link expires in 1 hour.

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

export async function sendTestEmail(email: string): Promise<void> {
    const subject = "Test Email from Mesynx AI";

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

This is a test email from Mesynx AI to verify your email notification settings.

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
