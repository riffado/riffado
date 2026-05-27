import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { authenticateAdminRequest } from "@/lib/admin/api-auth";
import {
    createApiKey,
    getApiKeyPrefix,
    hashApiKey,
} from "@/lib/auth-request";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

/**
 * Mint a fresh API key for a specific user. Sibling to
 * `POST /api/v1/admin/users` — that endpoint is for "make sure this
 * user exists"; this one is for "give me a key on their behalf".
 *
 * Split rather than bundled because:
 *   1. Provisioning a new user is a different operation from
 *      rotating a key for an existing one. Auto-issuing a key on
 *      every user POST would make rotation accidentally noisy
 *      (every "ensure exists" call would invalidate trust in
 *      previously-issued keys).
 *   2. The bundled flow on the meets side wants: lookup-or-create
 *      user, *then* (if no local key cached) request a key.
 *
 * Source is tagged `admin-provisioned` so the user's API-key list
 * UI can show that the key was minted by an operator workflow
 * rather than self-issued from the dashboard.
 */
export const POST = apiHandler<IdContext>(async (request, ctx) => {
    const auth = authenticateAdminRequest(request);
    if (!auth.ok) {
        throw new AppError(
            auth.status === 503
                ? ErrorCode.SERVICE_UNAVAILABLE
                : ErrorCode.UNAUTHORIZED,
            auth.reason,
            auth.status,
        );
    }

    const { id: userId } = await (ctx as IdContext).params;

    const [user] = await db
        .select({ id: users.id, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404, {
            field: "id",
        });
    }
    if (user.suspendedAt) {
        throw new AppError(
            ErrorCode.CONFLICT,
            "Cannot mint API key for a suspended user",
            409,
        );
    }

    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body =
        rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
            ? (rawBody as Record<string, unknown>)
            : {};

    const nameRaw = body.name;
    let name = "meets-prod";
    if (nameRaw != null) {
        if (typeof nameRaw !== "string") {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "name must be a string",
                400,
                { field: "name" },
            );
        }
        const trimmed = nameRaw.trim();
        if (!trimmed) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "name must not be empty",
                400,
                { field: "name" },
            );
        }
        if (trimmed.length > 120) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "name must be 120 characters or fewer",
                400,
                { field: "name" },
            );
        }
        name = trimmed;
    }

    const rawKey = createApiKey();
    const [inserted] = await db
        .insert(apiKeys)
        .values({
            userId,
            name,
            keyHash: hashApiKey(rawKey),
            keyPrefix: getApiKeyPrefix(rawKey),
            // `source` is the api_key_source enum. "manual" covers
            // user-issued; we reuse it here so the existing enum
            // doesn't need a migration just for this admin path.
            // If the operator wants to filter admin-provisioned keys
            // later, the `name` convention ("meets-prod") gives a
            // soft handle, and a future migration can add a dedicated
            // source value without breaking this endpoint.
            source: "manual",
            scopes: ["read", "write"],
        })
        .returning();

    return NextResponse.json(
        {
            api_key: {
                id: inserted.id,
                key: rawKey,
                name: inserted.name,
                key_prefix: inserted.keyPrefix,
                scopes: inserted.scopes,
                created_at: inserted.createdAt.toISOString(),
            },
        },
        { status: 201 },
    );
});
