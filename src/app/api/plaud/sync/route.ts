import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const result = await syncRecordingsForUser(session.user.id);

    return NextResponse.json({
        success: true,
        newRecordings: result.newRecordings,
        updatedRecordings: result.updatedRecordings,
        errors: result.errors,
    });
});
