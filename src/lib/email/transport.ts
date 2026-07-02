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

/**
 * Remove every `<tagName ...>...</tagName ...>` block from `input`, scanning
 * manually (no regex replace) so there's no reliance on proving regex-based
 * removal converges to a fixed point. Each iteration removes exactly one
 * block; nested/overlapping open tags inside a block (e.g. "<scr<script>ipt>")
 * are covered because the next matching close tag is always searched for
 * after the open tag we just found, and the whole span is deleted in one cut
 * rather than reassembled from a regex substitution.
 */
function stripTagBlocks(input: string, tagName: string): string {
    const lower = input.toLowerCase();
    const openPrefix = `<${tagName}`;
    const closePrefix = `</${tagName}`;
    let out = "";
    let i = 0;

    while (i < input.length) {
        const openIdx = lower.indexOf(openPrefix, i);
        if (openIdx === -1) {
            out += input.slice(i);
            break;
        }
        // Require the match to be a real tag boundary ("<script>", "<script ",
        // "<script/>"), not a longer tag/attribute name like "<scriptx>".
        const boundary = lower[openIdx + openPrefix.length];
        if (boundary !== undefined && /[a-z0-9-]/.test(boundary)) {
            out += input.slice(i, openIdx + openPrefix.length);
            i = openIdx + openPrefix.length;
            continue;
        }
        const openTagEnd = lower.indexOf(">", openIdx);
        if (openTagEnd === -1) {
            out += input.slice(i, openIdx);
            break;
        }
        out += input.slice(i, openIdx);
        const closeIdx = lower.indexOf(closePrefix, openTagEnd);
        if (closeIdx === -1) {
            i = input.length;
            break;
        }
        const closeTagEnd = lower.indexOf(">", closeIdx);
        i = closeTagEnd === -1 ? input.length : closeTagEnd + 1;
    }

    return out;
}

/** Strip HTML tags for a synthetic plain-text alternative. */
export function htmlToText(html: string): string {
    let result = html;

    // Remove script/style blocks, including their content, via manual
    // scanning (see stripTagBlocks) rather than a regex replace, so there's
    // no residual-match risk from nested/overlapping tags reforming after a
    // single substitution pass.
    result = stripTagBlocks(result, "style");
    result = stripTagBlocks(result, "script");

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
