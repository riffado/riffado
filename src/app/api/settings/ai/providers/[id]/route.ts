import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

// PUT - Update AI provider
export const PUT = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;
    const {
        apiKey,
        baseUrl,
        defaultModel,
        isDefaultTranscription,
        isDefaultEnhancement,
    } = await request.json();

    // Verify ownership
    const [existing] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.id, id),
                eq(apiCredentials.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, "Provider not found", 404);
    }

    // On hosted, the app process can't reach the user's machine — reject
    // localhost / loopback baseUrls (e.g. LM Studio, Ollama) with a clear
    // message. Self-host accepts everything.
    const baseUrlCheck = validateAiBaseUrl(baseUrl, {
        isHosted: env.IS_HOSTED,
    });
    if (!baseUrlCheck.ok) {
        throw new AppError(ErrorCode.INVALID_INPUT, baseUrlCheck.message, 400, {
            field: "baseUrl",
        });
    }

    // Use a transaction to ensure atomic update of default providers
    await db.transaction(async (tx) => {
        // If setting as default, remove default flag from other providers
        if (isDefaultTranscription) {
            await tx
                .update(apiCredentials)
                .set({ isDefaultTranscription: false })
                .where(
                    and(
                        eq(apiCredentials.userId, session.user.id),
                        eq(apiCredentials.isDefaultTranscription, true),
                    ),
                );
        }

        if (isDefaultEnhancement) {
            await tx
                .update(apiCredentials)
                .set({ isDefaultEnhancement: false })
                .where(
                    and(
                        eq(apiCredentials.userId, session.user.id),
                        eq(apiCredentials.isDefaultEnhancement, true),
                    ),
                );
        }

        // Build update object
        const updateData: {
            baseUrl: string | null;
            defaultModel: string | null;
            isDefaultTranscription: boolean;
            isDefaultEnhancement: boolean;
            updatedAt: Date;
            apiKey?: string;
        } = {
            baseUrl: baseUrl || null,
            defaultModel: defaultModel || null,
            isDefaultTranscription: isDefaultTranscription || false,
            isDefaultEnhancement: isDefaultEnhancement || false,
            updatedAt: new Date(),
        };

        // Only update API key if provided
        if (apiKey) {
            updateData.apiKey = encrypt(apiKey);
        }

        // Update provider — re-scope by userId on UPDATE for defense-in-depth.
        await tx
            .update(apiCredentials)
            .set(updateData)
            .where(
                and(
                    eq(apiCredentials.id, id),
                    eq(apiCredentials.userId, session.user.id),
                ),
            );
    });

    return NextResponse.json({ success: true });
});

// DELETE - Remove AI provider
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const { id } = await (context as IdContext).params;

    // Verify ownership and delete
    await db
        .delete(apiCredentials)
        .where(
            and(
                eq(apiCredentials.id, id),
                eq(apiCredentials.userId, session.user.id),
            ),
        );

    return NextResponse.json({ success: true });
});
