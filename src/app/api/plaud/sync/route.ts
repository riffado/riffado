import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import { enforcePlaudSyncRateLimit } from "@/lib/plaud/sync-rate-limit";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const limited = await enforcePlaudSyncRateLimit(session.user.id);
    if (limited) return limited;

    const result = await syncRecordingsForUser(session.user.id);

    return NextResponse.json({
        success: true,
        newRecordings: result.newRecordings,
        updatedRecordings: result.updatedRecordings,
        errors: result.errors,
        inProgress: result.inProgress,
        needsReconnect: result.needsReconnect ?? false,
    });
});
