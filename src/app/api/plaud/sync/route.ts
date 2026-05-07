import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

export const POST = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(
            ErrorCode.AUTH_SESSION_MISSING,
            "You must be logged in to sync recordings",
            401,
        );
    }

    const result = await syncRecordingsForUser(session.user.id);

    return NextResponse.json({
        success: true,
        newRecordings: result.newRecordings,
        updatedRecordings: result.updatedRecordings,
        errors: result.errors,
    });
});
