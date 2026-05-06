import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { personalAccessTokens } from "@/db/schema";
import { auth } from "@/lib/auth";

export type AuthenticatedRequest = {
    user: { id: string };
    via: "session" | "token";
    tokenId?: string;
};

export type PersonalAccessTokenRow = typeof personalAccessTokens.$inferSelect;

const TOKEN_PREFIX = "opp_";
const TOKEN_RANDOM_LENGTH = 24;
const DISPLAY_PREFIX_LENGTH = 12;

export function createPersonalAccessToken(): string {
    return `${TOKEN_PREFIX}${nanoid(TOKEN_RANDOM_LENGTH)}`;
}

export function hashPersonalAccessToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function getPersonalAccessTokenPrefix(token: string): string {
    return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function isPersonalAccessTokenActive(
    token: Pick<PersonalAccessTokenRow, "expiresAt" | "revokedAt">,
    now = new Date(),
): boolean {
    if (token.revokedAt) return false;
    if (token.expiresAt && token.expiresAt <= now) return false;
    return true;
}

export function normalizeTokenScopes(scopes: unknown): string[] {
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

export async function authenticateRequest(
    request: Request,
): Promise<AuthenticatedRequest | null> {
    const bearerToken = getBearerToken(request);

    if (bearerToken?.startsWith(TOKEN_PREFIX)) {
        const tokenHash = hashPersonalAccessToken(bearerToken);
        const now = new Date();

        const [token] = await db
            .select()
            .from(personalAccessTokens)
            .where(
                and(
                    eq(personalAccessTokens.tokenHash, tokenHash),
                    isNull(personalAccessTokens.revokedAt),
                    or(
                        isNull(personalAccessTokens.expiresAt),
                        gt(personalAccessTokens.expiresAt, now),
                    ),
                ),
            )
            .limit(1);

        if (!token) return null;

        void db
            .update(personalAccessTokens)
            .set({ lastUsedAt: now, updatedAt: now })
            .where(
                and(
                    eq(personalAccessTokens.id, token.id),
                    eq(personalAccessTokens.userId, token.userId),
                ),
            )
            .catch((error) => {
                console.error(
                    "Failed to update API token last_used_at:",
                    error,
                );
            });

        return {
            user: { id: token.userId },
            via: "token",
            tokenId: token.id,
        };
    }

    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) return null;

    return {
        user: { id: session.user.id },
        via: "session",
    };
}
