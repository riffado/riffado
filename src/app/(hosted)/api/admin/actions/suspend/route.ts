import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { suspendUser } from "@/lib/hosted/admin/actions";
import { requireAdminMutation } from "@/lib/hosted/admin/guard";
import { clientIpFromHeaders } from "@/lib/hosted/admin/ip-allowlist";

/**
 * POST /api/admin/actions/suspend
 *
 * Errors flow through `apiHandler`: the action layer throws AppError with
 * the right code/status (NOT_FOUND for missing user, MISSING_REQUIRED_FIELD
 * for empty reason); anything else maps to INTERNAL_ERROR / 500. We do not
 * blanket-400 every failure, and we never leak raw exception messages.
 */
export const POST = apiHandler(async (request: Request) => {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/suspend",
        method: "POST",
    });
    const parsed = await request.json().catch(() => null);
    const body =
        parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    const userId = typeof body.userId === "string" ? body.userId : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!userId) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "userId required",
            400,
            { field: "userId" },
        );
    }

    const result = await suspendUser(
        {
            adminUserId: admin.user.id,
            adminUserEmail: admin.user.email,
            ip: clientIpFromHeaders(await nextHeaders()),
            reason,
        },
        userId,
    );
    return NextResponse.json(result);
});
