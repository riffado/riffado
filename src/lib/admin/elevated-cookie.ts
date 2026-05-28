import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export const ADMIN_ELEVATED_COOKIE = "riffado_admin_elev";

interface ElevatedPayload {
    userId: string;
    issuedAt: number;
}

function secret(): string {
    const s = env.BETTER_AUTH_SECRET;
    if (!s)
        throw new Error(
            "BETTER_AUTH_SECRET missing -- cannot sign admin cookie",
        );
    return s;
}

function macFor(userId: string, issuedAt: number): string {
    return createHmac("sha256", secret())
        .update(`${userId}.${issuedAt}`)
        .digest("hex");
}

export function signElevatedCookie(userId: string, now = Date.now()): string {
    const mac = macFor(userId, now);
    return `${userId}.${now}.${mac}`;
}

/** Verify the cookie's structure + HMAC. Expiry is checked separately. */
export function verifyElevatedCookie(
    raw: string | undefined | null,
): ElevatedPayload | null {
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [userId, issuedAtStr, providedMac] = parts;
    const issuedAt = Number(issuedAtStr);
    if (!userId || !Number.isFinite(issuedAt)) return null;

    const expectedMac = macFor(userId, issuedAt);
    const a = Buffer.from(expectedMac, "hex");
    const b = Buffer.from(providedMac, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    return { userId, issuedAt };
}

export function isWithinReauthTtl(
    payload: ElevatedPayload,
    now = Date.now(),
): boolean {
    const ttlMs = env.ADMIN_REAUTH_TTL_MINUTES * 60 * 1000;
    return now - payload.issuedAt <= ttlMs;
}

export function isWithinMutationTtl(
    payload: ElevatedPayload,
    now = Date.now(),
): boolean {
    const ttlMs = env.ADMIN_MUTATION_TTL_MINUTES * 60 * 1000;
    return now - payload.issuedAt <= ttlMs;
}
