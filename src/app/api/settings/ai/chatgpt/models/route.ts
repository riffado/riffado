import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { listModelsForCredential } from "@/lib/ai/chatgpt/connect";
import { assertChatGptPlanUsageEnabled } from "@/lib/ai/chatgpt/feature";
import { CHATGPT_PROVIDER_NAME } from "@/lib/ai/chatgpt/shared";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// GET - Models available on the user's connected ChatGPT plan.
export const GET = apiHandler(async (request: Request) => {
    assertChatGptPlanUsageEnabled();
    const session = await requireApiSession(request);

    const [row] = await db
        .select({
            id: apiCredentials.id,
            userId: apiCredentials.userId,
            apiKey: apiCredentials.apiKey,
        })
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, session.user.id),
                eq(apiCredentials.provider, CHATGPT_PROVIDER_NAME),
            ),
        )
        .limit(1);

    if (!row) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "ChatGPT isn't connected",
            404,
        );
    }

    return NextResponse.json({ models: await listModelsForCredential(row) });
});
