import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { softDeleteRecording } from "@/lib/hosted/admin/actions";
import { requireAdminMutation } from "@/lib/hosted/admin/guard";
import { clientIpFromHeaders } from "@/lib/hosted/admin/ip-allowlist";

export const POST = apiHandler(async (request: Request) => {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/soft-delete-recording",
        method: "POST",
    });
    const parsed = await request.json().catch(() => null);
    const body =
        parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    const recordingId =
        typeof body.recordingId === "string" ? body.recordingId : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!recordingId) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "recordingId required",
            400,
            { field: "recordingId" },
        );
    }

    const result = await softDeleteRecording(
        {
            adminUserId: admin.user.id,
            adminUserEmail: admin.user.email,
            ip: clientIpFromHeaders(await nextHeaders()),
            reason,
        },
        recordingId,
    );
    return NextResponse.json(result);
});
