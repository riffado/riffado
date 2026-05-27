import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticateAdminRequest } from "@/lib/admin/api-auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * Operator-facing user provisioning. Caller is the bootstrap layer in
 * an integrating system (meets / ERPnext) that wants to map real
 * humans onto OpenPlaud accounts 1:1.
 *
 * Lookup-or-create on email: idempotent provisioning. Re-calling
 * with the same email returns the existing record. No password is
 * set on creation — these users authenticate via API keys against
 * `/api/v1/*` only, never through the web /login flow. If an
 * operator later wants to grant a user web access, they can issue
 * a password-reset via the standard better-auth flow.
 *
 * The ALLOWED_EMAIL_DOMAINS gate that the user-create hook enforces
 * is *deliberately bypassed* here: the admin surface is the
 * operator's policy override (and the operator is the one who set
 * the allowlist in the first place). This matches the spirit of an
 * admin endpoint — provisioning happens for users the operator has
 * already approved out-of-band.
 *
 * Returns:
 *   201 with `{ user, created: true }` when a new user was inserted
 *   200 with `{ user, created: false }` when the email already existed
 */
export const POST = apiHandler(async (request: Request) => {
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

    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body =
        rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
            ? (rawBody as Record<string, unknown>)
            : {};

    const emailRaw = body.email;
    const nameRaw = body.name;

    if (typeof emailRaw !== "string" || !emailRaw.trim()) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "email is required",
            400,
            { field: "email" },
        );
    }
    const email = emailRaw.trim().toLowerCase();
    // Cheap shape check — we don't need RFC-perfect parsing here, the
    // DB unique constraint catches duplicates anyway. This just keeps
    // obviously-broken values from creating ghost rows.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "email is not a valid address",
            400,
            { field: "email" },
        );
    }
    if (email.length > 255) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "email must be 255 characters or fewer",
            400,
            { field: "email" },
        );
    }

    let name: string | null = null;
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
        if (trimmed.length > 255) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "name must be 255 characters or fewer",
                400,
                { field: "name" },
            );
        }
        name = trimmed || null;
    }

    const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (existing) {
        return NextResponse.json(
            {
                user: {
                    id: existing.id,
                    email: existing.email,
                    name: existing.name,
                    created_at: existing.createdAt.toISOString(),
                    suspended_at: existing.suspendedAt?.toISOString() ?? null,
                },
                created: false,
            },
            { status: 200 },
        );
    }

    const [inserted] = await db
        .insert(users)
        .values({
            email,
            name,
            // No password hash, no account row — this user can't sign
            // into the web UI. They use API keys only. The operator
            // can later trigger a password-reset email if web access
            // is needed.
            emailVerified: true,
        })
        .returning();

    return NextResponse.json(
        {
            user: {
                id: inserted.id,
                email: inserted.email,
                name: inserted.name,
                created_at: inserted.createdAt.toISOString(),
                suspended_at: null,
            },
            created: true,
        },
        { status: 201 },
    );
});
