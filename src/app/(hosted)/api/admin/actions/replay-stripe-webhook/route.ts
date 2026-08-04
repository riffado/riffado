import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { replayStripeWebhookEvent } from "@/lib/hosted/admin/actions";
import { requireAdminMutation } from "@/lib/hosted/admin/guard";
import { clientIpFromHeaders } from "@/lib/hosted/admin/ip-allowlist";

/** Safely requeues a terminal Stripe inbox event without deleting its audit row. */
export const POST = apiHandler(async (request: Request) => {
    const admin = await requireAdminMutation({
        route: "/api/admin/actions/replay-stripe-webhook",
        method: "POST",
    });
    const parsed = await request.json().catch(() => null);
    const body =
        parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    const eventId = typeof body.eventId === "string" ? body.eventId : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!eventId) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "eventId required",
            400,
            { field: "eventId" },
        );
    }

    const result = await replayStripeWebhookEvent(
        {
            adminUserId: admin.user.id,
            adminUserEmail: admin.user.email,
            ip: clientIpFromHeaders(await nextHeaders()),
            reason,
        },
        eventId,
    );
    return NextResponse.json(result);
});
