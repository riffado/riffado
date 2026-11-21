import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ErrorCode } from "@/lib/errors";
import { getPartStatus } from "@/lib/status/parts";
import { extractBearer, tokensMatch } from "@/lib/status/token";
import { isStatusPart, type StatusResponse } from "@/lib/status/types";

export const dynamic = "force-dynamic";

type PartContext = { params: Promise<{ part: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function notFound(): NextResponse {
    return NextResponse.json(
        { error: "Not found", code: ErrorCode.NOT_FOUND },
        { status: 404, headers: NO_STORE },
    );
}

/**
 * GET /api/status/<part>: status page check, polled by Kener. Requires
 * `Authorization: Bearer <STATUS_TOKEN>`. 404 when STATUS_TOKEN is unset or
 * the part is unknown or not applicable here, 401 on a missing or wrong
 * token, otherwise always 200 with `{ state, latencyMs, ... }`.
 *
 * Kener should poll every part once a minute. Each check is stored as that
 * minute's verdict, and slow/down is only shown once enough checked
 * minutes in the window agree (see `sustainedVerdict`); polling less often
 * leaves fewer checked minutes and makes the sustained answer coarser.
 */
export async function GET(
    request: Request,
    context: PartContext,
): Promise<NextResponse> {
    const expected = env.STATUS_TOKEN;
    if (!expected) return notFound();

    const provided = extractBearer(request.headers.get("authorization"));
    if (!provided || !tokensMatch(provided, expected)) {
        return NextResponse.json(
            { error: "Unauthorized", code: ErrorCode.UNAUTHORIZED },
            { status: 401, headers: NO_STORE },
        );
    }

    const { part } = await context.params;
    if (!isStatusPart(part)) return notFound();

    const start = performance.now();
    let body: StatusResponse | null;
    try {
        body = await getPartStatus(part);
    } catch (error) {
        console.error(
            `[status] check for ${part} failed:`,
            error instanceof Error ? error.message : error,
        );
        body = {
            part,
            state: "down",
            reason: "check-failed",
            latencyMs: Math.round(performance.now() - start),
            source: "probe",
            checkedAt: new Date().toISOString(),
        };
    }
    if (!body) return notFound();

    return NextResponse.json(body, { status: 200, headers: NO_STORE });
}
