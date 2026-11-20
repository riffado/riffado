import { NextResponse } from "next/server";
import { isChatGptPlanUsageEnabled } from "@/lib/ai/chatgpt/feature";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";

// GET - Whether this instance offers the ChatGPT plan-usage provider.
// The provider dialogs use it to show or hide the ChatGPT option.
export const GET = apiHandler(async (request: Request) => {
    await requireApiSession(request);
    return NextResponse.json({ enabled: isChatGptPlanUsageEnabled() });
});
