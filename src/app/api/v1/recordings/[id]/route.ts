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
const EXTERNAL_ID_MAX_LEN = 255;

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
 * the v1 rate-limit pair.
 *
 * Mutable fields: `context`, `external_id`. Either or both may
 * appear; omitting both is a 400. Pass `null` to clear; pass a
 * string to set. Field-level validation happens before the UPDATE
 * so a single invalid value fails fast.
 *
 * `external_id` writes are unique-per-user (partial index on
 * recordings(user_id, external_id) WHERE external_id IS NOT NULL).
 * The DB error from a collision surfaces as 409 to distinguish
 * "someone else owns this id" from "your request was malformed".
 * Lets the B3 pull-import flow set `external_id` retroactively
 * after meets imports an OpenPlaud-originated recording, so future
 * `summary.created` / `recording.updated` webhooks for that row
 * land on the right `Meeting Recording` doc.
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
    const body: { context?: string | null; external_id?: string | null } =
        rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
            ? (rawBody as {
                  context?: string | null;
                  external_id?: string | null;
              })
            : {};

    const hasContext = Object.hasOwn(body, "context");
    const hasExternalId = Object.hasOwn(body, "external_id");
    if (!hasContext && !hasExternalId) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Nothing to update",
            400,
        );
    }

    const setFields: {
        context?: string | null;
        externalId?: string | null;
        updatedAt: Date;
    } = { updatedAt: new Date() };

    if (hasContext) {
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
        setFields.context = trimmed ? encryptText(trimmed) : null;
    }

    if (hasExternalId) {
        const next = body.external_id;
        if (next != null) {
            if (typeof next !== "string") {
                throw new AppError(
                    ErrorCode.INVALID_INPUT,
                    "external_id must be a string or null",
                    400,
                    { field: "external_id" },
                );
            }
            if (next.length > EXTERNAL_ID_MAX_LEN) {
                throw new AppError(
                    ErrorCode.INVALID_INPUT,
                    `external_id must be ${EXTERNAL_ID_MAX_LEN} characters or fewer`,
                    400,
                    { field: "external_id" },
                );
            }
        }
        const trimmed = typeof next === "string" ? next.trim() : null;
        setFields.externalId = trimmed || null;
    }

    let updated: { id: string }[];
    try {
        updated = await db
            .update(recordings)
            .set(setFields)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, authn.user.id),
                    isNull(recordings.deletedAt),
                ),
            )
            .returning({ id: recordings.id });
    } catch (err) {
        // postgres unique_violation is SQLSTATE 23505. The only unique
        // constraint touchable from this handler is the partial
        // (user_id, external_id) index — any 23505 here means the
        // caller tried to attach an `external_id` that's already in
        // use on another of their recordings. 409 distinguishes that
        // from "your request was malformed" (400) and "row doesn't
        // exist" (404).
        const e = err as { code?: string } | null;
        if (e && e.code === "23505") {
            throw new AppError(
                ErrorCode.CONFLICT,
                "external_id already in use on another recording",
                409,
                { field: "external_id" },
            );
        }
        throw err;
    }

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
