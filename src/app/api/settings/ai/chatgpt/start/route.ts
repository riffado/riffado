import { NextResponse } from "next/server";
import {
    sealPendingSignIn,
    startChatGptSignIn,
} from "@/lib/ai/chatgpt/connect";
import { assertChatGptPlanUsageEnabled } from "@/lib/ai/chatgpt/feature";
import { signInCookieOptions } from "@/lib/ai/chatgpt/route-helpers";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";

// POST - Begin "Sign in with ChatGPT". Returns the OpenAI authorize URL
// and keeps the PKCE verifier/state sealed in an HttpOnly cookie until
// the user pastes the loopback URL back into /complete.
export const POST = apiHandler(async (request: Request) => {
    assertChatGptPlanUsageEnabled();
    const session = await requireApiSession(request);

    const { authorizeUrl, pending } = await startChatGptSignIn(session.user.id);

    const res = NextResponse.json({ authorizeUrl });
    res.cookies.set({
        ...signInCookieOptions(),
        value: sealPendingSignIn(pending),
    });
    return res;
});
