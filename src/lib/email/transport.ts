import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { isSmtpConfigured } from "@/lib/smtp";

interface SendEmailWithHeadersOptions {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
}

export class SmtpNotConfiguredError extends Error {
    constructor() {
        super(
            "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD to send mail.",
        );
        this.name = "SmtpNotConfiguredError";
    }
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
    if (!isSmtpConfigured()) return null;
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

/** Send one email with custom headers; returns the SMTP message-id. */
export async function sendEmailWithHeaders(
    options: SendEmailWithHeadersOptions,
): Promise<string | undefined> {
    const mailer = getTransporter();
    if (!mailer) throw new SmtpNotConfiguredError();

    const result = await mailer.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        headers: options.headers,
    });

    return typeof result.messageId === "string" ? result.messageId : undefined;
}

/** Resolve the `From:` address for a given campaign kind. */
export function resolveFromAddress(
    kind: "transactional" | "announcement" | "marketing",
    override?: string,
): string {
    if (override) return override;
    if (kind === "transactional") {
        return env.SMTP_FROM ?? env.SMTP_USER ?? "noreply@riffado.com";
    }
    return (
        env.SMTP_MARKETING_FROM ??
        env.SMTP_FROM ??
        env.SMTP_USER ??
        "noreply@riffado.com"
    );
}

/** Strip HTML tags for a synthetic plain-text alternative. */
export function htmlToText(html: string): string {
    let result = html;

    // Remove script/style blocks, including their content. Looped to catch
    // nested/overlapping tags a single pass could miss (e.g. "<scr<script>ipt>").
    // Closing tags allow any non-">" characters before ">" (e.g. "</script foo=\"bar\">",
    // "</script\t\nbar>"), matching how the opening-tag pattern already tolerates attributes.
    let previous: string;
    do {
        previous = result;
        result = result
            .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi, "");
    } while (result !== previous);

    result = result.replace(/<[^>]*>/g, "");

    // Decode entities; &amp; must be decoded last, otherwise text like
    // "&amp;lt;" would double-unescape into "<" instead of staying "&lt;".
    result = result
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");

    return result
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
}
