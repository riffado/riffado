import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { listUserProviders } from "@/lib/ai/list-providers";
import { supportsEnhancement } from "@/lib/ai/provider-presets";
import { setDefaultTranscriptionProvider } from "@/lib/ai/set-default-transcription";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { requireApiSession } from "@/lib/auth-server";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { captureServerEvent } from "@/lib/posthog-server";
import { validateElevenLabsBaseUrl } from "@/lib/transcription/elevenlabs-transcribe";

// GET - List all AI providers for the user
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    return NextResponse.json({
        providers: await listUserProviders(session.user.id),
    });
});

// POST - Add new AI provider
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const {
        provider,
        apiKey,
        baseUrl,
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

    if (isDefaultEnhancement && !supportsEnhancement(provider)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            `${provider} does not support AI enhancements (transcription only)`,
            400,
            { field: "isDefaultEnhancement" },
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
    if (provider === "ElevenLabs") {
        const elevenLabsBaseUrlCheck = validateElevenLabsBaseUrl(baseUrl, {
            isHosted: env.IS_HOSTED,
        });
        if (!elevenLabsBaseUrlCheck.ok) {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                elevenLabsBaseUrlCheck.message,
                400,
                { field: "baseUrl" },
            );
        }
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
                defaultModel: defaultModel || null,
                isDefaultTranscription: isDefaultTranscription || false,
                isDefaultEnhancement: isDefaultEnhancement || false,
            })
            .returning({
                id: apiCredentials.id,
                provider: apiCredentials.provider,
                baseUrl: apiCredentials.baseUrl,
                defaultModel: apiCredentials.defaultModel,
                isDefaultTranscription: apiCredentials.isDefaultTranscription,
                isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
            });
    });

    if (isDefaultTranscription) {
        await setDefaultTranscriptionProvider(session.user.id, newProvider.id);
    }

    // Provider label only -- never baseUrl, which can be a private
    // hostname (homelab Ollama, internal LM Studio, etc.).
    await captureServerEvent({
        distinctId: session.user.id,
        event: "ai_provider_added",
        properties: {
            provider,
            has_custom_base_url: Boolean(baseUrl),
            is_default_transcription: Boolean(isDefaultTranscription),
        },
    });

    return NextResponse.json({ provider: newProvider });
});
