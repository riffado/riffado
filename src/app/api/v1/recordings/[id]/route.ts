import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { authenticateRequest } from "@/lib/auth-request";
import { encryptText } from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import {
    enforceV1AuthenticatedRateLimit,
    enforceV1IpRateLimit,
} from "@/lib/v1/rate-limit";
import { getV1RecordingDetailForUser } from "@/lib/v1/serialize";

type IdContext = { params: Promise<{ id: string }> };

const CONTEXT_MAX_LEN = 4000;

export const GET = apiHandler<IdContext>(async (request, context) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401);
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const { id } = await (context as IdContext).params;
    const recording = await getV1RecordingDetailForUser(authn.user.id, id);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
            { id },
        );
    }

    return NextResponse.json(recording);
});

/**
 * Update mutable fields on a recording. Mirrors
 * `PATCH /api/recordings/[id]` but speaks the v1 surface: bearer API
 * key auth via `authenticateRequest` instead of browser session, and
 * the v1 rate-limit pair. Currently only `context` is mutable —
 * extending this rather than adding a per-field route so future
 * editable fields don't accrue more endpoints.
 *
 * Use this from server-to-server callers (the dashboard GUI editor
 * uses the non-v1 path because it has a cookie session). Sending
 * `context: null` (or omitting / blanking the string) clears the
 * field; omitting the key entirely is a 400.
 */
export const PATCH = apiHandler<IdContext>(async (request, ctx) => {
    const ipLimitResponse = await enforceV1IpRateLimit(request);
    if (ipLimitResponse) return ipLimitResponse;

    const authn = await authenticateRequest(request);
    if (!authn) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "Unauthorized", 401);
    }

    const authLimitResponse = await enforceV1AuthenticatedRateLimit(authn);
    if (authLimitResponse) return authLimitResponse;

    const { id } = await (ctx as IdContext).params;
    // `request.json()` resolves the JSON literal `null` to JS null
    // without throwing; only invalid JSON hits the catch. Without this
    // normalization, `Object.hasOwn(null, ...)` below throws TypeError
    // and a malformed body leaks as a 500 instead of the intended 400.
    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body: { context?: string | null } =
        rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
            ? (rawBody as { context?: string | null })
            : {};

    if (!Object.hasOwn(body, "context")) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Nothing to update",
            400,
        );
    }

    const next = body.context;
    if (next != null) {
        if (typeof next !== "string") {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "context must be a string or null",
                400,
                { field: "context" },
            );
        }
        if (next.length > CONTEXT_MAX_LEN) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                `context must be ${CONTEXT_MAX_LEN} characters or fewer`,
                400,
                { field: "context" },
            );
        }
    }

    const trimmed = typeof next === "string" ? next.trim() : null;
    const stored = trimmed ? encryptText(trimmed) : null;

    const updated = await db
        .update(recordings)
        .set({ context: stored, updatedAt: new Date() })
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, authn.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .returning({ id: recordings.id });

    if (updated.length === 0) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
            { id },
        );
    }

    const recording = await getV1RecordingDetailForUser(authn.user.id, id);
    return NextResponse.json(recording);
});
