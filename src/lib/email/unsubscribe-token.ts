import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type UnsubscribeAudience = "user" | "subscriber";

const PURPOSE = "marketing-unsubscribe-v1";

function key(): Buffer {
    const secret = env.BETTER_AUTH_SECRET;
    if (!secret) {
        throw new Error(
            "unsubscribe-token: BETTER_AUTH_SECRET is not set; cannot sign/verify tokens",
        );
    }
    return Buffer.from(secret, "utf8");
}

function macBytes(audience: UnsubscribeAudience, id: string): Buffer {
    return createHmac("sha256", key())
        .update(`${PURPOSE}:${audience}:${id}`)
        .digest();
}

/** HMAC token for an unsubscribe link, base64url-encoded. */
export function signUnsubscribeToken(
    audience: UnsubscribeAudience,
    id: string,
): string {
    return macBytes(audience, id).toString("base64url");
}

/** Constant-time verify. False for any decode error, length mismatch, or HMAC mismatch. */
export function verifyUnsubscribeToken(
    audience: UnsubscribeAudience,
    id: string,
    token: string,
): boolean {
    if (typeof token !== "string" || token.length === 0) return false;

    let provided: Buffer;
    try {
        provided = Buffer.from(token, "base64url");
    } catch {
        return false;
    }

    const expected = macBytes(audience, id);
    if (provided.length !== expected.length) return false;

    return timingSafeEqual(provided, expected);
}

/** Absolute unsubscribe URL for a recipient. Always anchored on APP_URL. */
export function buildUnsubscribeUrl(
    audience: UnsubscribeAudience,
    id: string,
): string {
    const base = env.APP_URL;
    if (!base) {
        throw new Error(
            "unsubscribe-token: APP_URL is not set; cannot build unsubscribe URL",
        );
    }
    const param = audience === "user" ? "u" : "s";
    const token = signUnsubscribeToken(audience, id);
    return `${base.replace(/\/$/, "")}/api/email/unsubscribe?${param}=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
}
