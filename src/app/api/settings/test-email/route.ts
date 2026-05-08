import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { sendTestEmail } from "@/lib/notifications/email";

export const POST = apiHandler(async (request: Request) => {
    await requireApiSession(request);

    // Tolerate malformed / null bodies: an unparseable JSON body is a
    // client input bug (400), not a server bug (500). Without the catch,
    // request.json() throws SyntaxError and apiHandler maps it to
    // INTERNAL_ERROR / 500.
    const body = (await request.json().catch(() => null)) as {
        email?: unknown;
    } | null;
    const email = body?.email;

    if (!email || typeof email !== "string" || !email.trim()) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Email address is required",
            400,
            { field: "email" },
        );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid email address",
            400,
            { field: "email" },
        );
    }

    // Send test email — sendTestEmail throws on failure; mapErrorToAppError
    // (SMTP* branches) converts the message to the right code/status.
    await sendTestEmail(email.trim());

    return NextResponse.json({ success: true });
});
