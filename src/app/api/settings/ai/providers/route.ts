import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { requireApiSession } from "@/lib/auth-server";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

// GET - List all AI providers for the user
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    let providers = await db
        .select({
            id: apiCredentials.id,
            provider: apiCredentials.provider,
            baseUrl: apiCredentials.baseUrl,
            nickname: apiCredentials.nickname,
            defaultModel: apiCredentials.defaultModel,
            isDefaultTranscription: apiCredentials.isDefaultTranscription,
            isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
            createdAt: apiCredentials.createdAt,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, session.user.id));

    // Silent auto-provision of Whisper container on same network if 0 providers exist
    if (!env.IS_HOSTED && providers.length === 0) {
        const WHISPER_DOCKER_TARGETS = [
            "http://whisper:8000/v1",
            "http://mesynx-ai-whisper:8000/v1",
        ];

        let foundUrl: string | null = null;
        let defaultModel = "faster-whisper";

        for (const url of WHISPER_DOCKER_TARGETS) {
            try {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 500);
                const res = await fetch(`${url}/models`, {
                    signal: controller.signal,
                });
                clearTimeout(id);
                if (res.ok) {
                    const data = await res.json();
                    defaultModel = data?.data?.[0]?.id || "faster-whisper";
                    foundUrl = url;
                    break;
                }
            } catch {}
        }

        if (foundUrl) {
            await db.insert(apiCredentials).values({
                userId: session.user.id,
                provider: "openai",
                apiKey: encrypt("local-bypass"),
                baseUrl: foundUrl,
                nickname: "Local Whisper",
                defaultModel,
                isDefaultTranscription: true,
                isDefaultEnhancement: false,
            });

            // Re-fetch providers
            providers = await db
                .select({
                    id: apiCredentials.id,
                    provider: apiCredentials.provider,
                    baseUrl: apiCredentials.baseUrl,
                    nickname: apiCredentials.nickname,
                    defaultModel: apiCredentials.defaultModel,
                    isDefaultTranscription:
                        apiCredentials.isDefaultTranscription,
                    isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
                    createdAt: apiCredentials.createdAt,
                })
                .from(apiCredentials)
                .where(eq(apiCredentials.userId, session.user.id));
        }
    }

    return NextResponse.json({ providers });
});

// POST - Add new AI provider
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const {
        provider,
        apiKey,
        baseUrl,
        nickname,
        defaultModel,
        isDefaultTranscription,
        isDefaultEnhancement,
    } = await request.json();

    if (!provider || !apiKey) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "Provider and API key are required",
            400,
        );
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

    // Encrypt the API key
    const encryptedKey = encrypt(apiKey);

    // Use a transaction to ensure atomic update of default providers
    const [newProvider] = await db.transaction(async (tx) => {
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

        // Insert new provider
        return await tx
            .insert(apiCredentials)
            .values({
                userId: session.user.id,
                provider,
                apiKey: encryptedKey,
                baseUrl: baseUrl || null,
                nickname: nickname || null,
                defaultModel: defaultModel || null,
                isDefaultTranscription: isDefaultTranscription || false,
                isDefaultEnhancement: isDefaultEnhancement || false,
            })
            .returning({
                id: apiCredentials.id,
                provider: apiCredentials.provider,
                baseUrl: apiCredentials.baseUrl,
                nickname: apiCredentials.nickname,
                defaultModel: apiCredentials.defaultModel,
                isDefaultTranscription: apiCredentials.isDefaultTranscription,
                isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
            });
    });

    return NextResponse.json({ provider: newProvider });
});
