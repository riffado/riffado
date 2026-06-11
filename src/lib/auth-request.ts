import { createHmac, randomInt } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";

export type AuthenticatedRequest = {
    user: { id: string };
    via: "session" | "api-key";
    apiKeyId?: string;
};

export type ApiKeyRow = typeof apiKeys.$inferSelect;

const API_KEY_PREFIX = "op_";
const DISPLAY_PREFIX_LENGTH = 12;
const DEFAULT_PAYLOAD_LENGTH = 30;
const MIN_PAYLOAD_LENGTH = 20;
const MAX_PAYLOAD_LENGTH = 64;
const CHECKSUM_LENGTH = 4;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(n: number): string {
    let out = "";
    for (let i = 0; i < n; i++) {
        out += B62[randomInt(0, 62)];
    }
    return out;
}

function crc32(str: string): number {
    let c = ~0 >>> 0;
    for (let i = 0; i < str.length; i++) {
        c ^= str.charCodeAt(i);
        for (let k = 0; k < 8; k++) {
            const mask = -(c & 1);
            c = (c >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return ~c >>> 0;
}

function toBase62Checksum(num: number): string {
    const n = num >>> 0;
    if (n === 0) return "0".padStart(CHECKSUM_LENGTH, "0");
    let out = "";
    let temp = n;
    while (temp > 0) {
        const idx = temp % 62;
        out = B62[idx] + out;
        temp = Math.floor(temp / 62);
    }
    if (out.length < CHECKSUM_LENGTH) {
        out = out.padStart(CHECKSUM_LENGTH, "0");
    }
    return out.slice(0, CHECKSUM_LENGTH);
}

/** Generate `op_{base62}{crc32-base62}`. Stored HMAC; legacy nanoid keys still authenticate. */
export function createApiKey(
    payloadLen: number = DEFAULT_PAYLOAD_LENGTH,
): string {
    const payloadLength = Math.max(
        MIN_PAYLOAD_LENGTH,
        Math.min(MAX_PAYLOAD_LENGTH, payloadLen),
    );
    const payload = randomBase62(payloadLength);
    const base = `${API_KEY_PREFIX}${payload}`;
    const checksum = toBase62Checksum(crc32(base));
    return `${base}${checksum}`;
}

/** CRC32-format check; rejects legacy nanoid keys. Not used in the auth path. */
export function validateApiKeyFormat(key: string): boolean {
    if (!key.startsWith(API_KEY_PREFIX)) return false;

    const body = key.slice(API_KEY_PREFIX.length);
    if (body.length < MIN_PAYLOAD_LENGTH + CHECKSUM_LENGTH) return false;
    if (body.length > MAX_PAYLOAD_LENGTH + CHECKSUM_LENGTH) return false;
    if (!/^[0-9A-Za-z]+$/.test(body)) return false;

    const payload = body.slice(0, -CHECKSUM_LENGTH);
    const providedChecksum = body.slice(-CHECKSUM_LENGTH);
    const expectedChecksum = toBase62Checksum(
        crc32(`${API_KEY_PREFIX}${payload}`),
    );
    return providedChecksum === expectedChecksum;
}

/** Mask a full key: first 12 + last 4 + bullets. */
export function maskApiKey(key: string): string {
    if (key.length < DISPLAY_PREFIX_LENGTH + CHECKSUM_LENGTH) return key;
    const head = key.slice(0, DISPLAY_PREFIX_LENGTH);
    const tail = key.slice(-CHECKSUM_LENGTH);
    const middle = "\u2022".repeat(
        key.length - DISPLAY_PREFIX_LENGTH - CHECKSUM_LENGTH,
    );
    return `${head}${middle}${tail}`;
}

export function hashApiKey(apiKey: string): string {
    const key = env.API_TOKEN_HASH_SECRET ?? env.BETTER_AUTH_SECRET;
    if (!key) {
        throw new Error("API key hash secret is not configured");
    }
    return createHmac("sha256", key).update(apiKey).digest("hex");
}

export function getApiKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function isApiKeyActive(
    apiKey: Pick<ApiKeyRow, "expiresAt" | "revokedAt">,
    now = new Date(),
): boolean {
    if (apiKey.revokedAt) return false;
    if (apiKey.expiresAt && apiKey.expiresAt <= now) return false;
    return true;
}

export function normalizeApiKeyScopes(scopes: unknown): string[] {
    if (!Array.isArray(scopes)) return ["read"];
    const normalized = scopes.filter((scope): scope is string => {
        return scope === "read";
    });
    return normalized.length > 0 ? normalized : ["read"];
}

function getBearerToken(request: Request): string | null {
    const authorization = request.headers.get("authorization");
    if (!authorization) return null;

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

async function assertUserNotSuspended(userId: string): Promise<void> {
    const [user] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (user?.suspendedAt) {
        throw new AppError(
            ErrorCode.ACCOUNT_SUSPENDED,
            "Account suspended",
            403,
        );
    }
}

export async function authenticateRequest(
    request: Request,
): Promise<AuthenticatedRequest | null> {
    const bearerToken = getBearerToken(request);

    if (bearerToken?.startsWith(API_KEY_PREFIX)) {
        const keyHash = hashApiKey(bearerToken);
        const now = new Date();

        const [apiKey] = await db
            .select()
            .from(apiKeys)
            .where(
                and(
                    eq(apiKeys.keyHash, keyHash),
                    isNull(apiKeys.revokedAt),
                    or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
                ),
            )
            .limit(1);

        if (!apiKey) return null;
        await assertUserNotSuspended(apiKey.userId);

        void db
            .update(apiKeys)
            .set({ lastUsedAt: now, updatedAt: now })
            .where(
                and(
                    eq(apiKeys.id, apiKey.id),
                    eq(apiKeys.userId, apiKey.userId),
                ),
            )
            .catch((error) => {
                console.error("Failed to update API key last_used_at:", error);
            });

        return {
            user: { id: apiKey.userId },
            via: "api-key",
            apiKeyId: apiKey.id,
        };
    }

    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) return null;
    await assertUserNotSuspended(session.user.id);

    return {
        user: { id: session.user.id },
        via: "session",
    };
}
