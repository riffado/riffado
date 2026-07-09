import { env } from "@/lib/env";

export type UnsubscribeHeaders = {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": string;
} & Record<string, string>;

/** RFC 8058 one-click unsubscribe headers for non-transactional email. */
export function buildUnsubscribeHeaders(
    unsubscribeUrl: string,
    mailtoAddress?: string,
): UnsubscribeHeaders {
    const mailto = mailtoAddress ?? defaultMailto();
    return {
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${mailto}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
}

function defaultMailto(): string {
    const appUrl = env.APP_URL;
    if (!appUrl) return "unsubscribe@example.invalid";
    try {
        const host = new URL(appUrl).hostname;
        return `unsubscribe@${host}`;
    } catch {
        return "unsubscribe@example.invalid";
    }
}
