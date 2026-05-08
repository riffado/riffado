import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { unsuspendUser } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { clientIpFromHeaders } from "@/lib/admin/ip-allowlist";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

export const POST = apiHandler(async (request: Request) => {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/unsuspend",
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

    const result = await unsuspendUser(
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
