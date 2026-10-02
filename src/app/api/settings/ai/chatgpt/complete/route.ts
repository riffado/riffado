import { NextResponse } from "next/server";
import { z } from "zod";
import {
    completeChatGptSignIn,
    unsealPendingSignIn,
} from "@/lib/ai/chatgpt/connect";
import { assertChatGptPlanUsageEnabled } from "@/lib/ai/chatgpt/feature";
import {
    CHATGPT_SIGN_IN_COOKIE,
    readCookie,
    signInCookieOptions,
} from "@/lib/ai/chatgpt/route-helpers";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { captureServerEvent } from "@/lib/posthog-server";

const bodySchema = z.object({
    callbackUrl: z.string().min(1).max(8192),
});

// POST - Finish "Sign in with ChatGPT" from the pasted loopback URL.
export const POST = apiHandler(async (request: Request) => {
    assertChatGptPlanUsageEnabled();
    const session = await requireApiSession(request);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Paste the URL from your browser",
            400,
            { field: "callbackUrl" },
        );
    }

    const pending = unsealPendingSignIn(
        readCookie(request, CHATGPT_SIGN_IN_COOKIE),
        session.user.id,
    );

    const result = await completeChatGptSignIn({
        userId: session.user.id,
        pending,
        callbackUrl: parsed.data.callbackUrl,
    });

    await captureServerEvent({
        distinctId: session.user.id,
        event: "ai_provider_added",
        properties: {
            provider: "ChatGPT",
            has_custom_base_url: false,
            is_default_transcription: false,
        },
    });

    const res = NextResponse.json({
        provider: {
            id: result.id,
            accountEmail: result.email,
            defaultModel: result.defaultModel,
        },
        models: result.models,
    });
    // One-shot: the code and verifier can't be reused.
    res.cookies.set({ ...signInCookieOptions(), value: "", maxAge: 0 });
    return res;
});
