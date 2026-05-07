import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { sendTestEmail } from "@/lib/notifications/email";

export const POST = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Email address is required",
            400,
            { field: "email" },
        );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "Invalid email address",
            400,
            { field: "email" },
        );
    }

    // Send test email — sendTestEmail throws on failure; mapErrorToAppError
    // (SMTP* branches) converts the message to the right code/status.
    await sendTestEmail(email);

    return NextResponse.json({ success: true });
}, ErrorCode.EMAIL_SEND_FAILED);
