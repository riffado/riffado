import { createHash, timingSafeEqual } from "node:crypto";

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function extractBearer(header: string | null): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

/** Constant-time token comparison (hashes first so lengths never leak). */
export function tokensMatch(provided: string, expected: string): boolean {
    const a = createHash("sha256").update(provided).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}
