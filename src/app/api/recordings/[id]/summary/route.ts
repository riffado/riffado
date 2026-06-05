import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    aiEnhancements,
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import {
    getAiOutputLanguageDirective,
    getDefaultSummaryPromptConfig,
    getSummaryPromptById,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { requireApiSession } from "@/lib/auth-server";
import { DEMO_SUMMARIES, isDemoRecordingId } from "@/lib/demo/fixtures";
import { decrypt } from "@/lib/encryption";
import {
    decryptJsonField,
    decryptText,
    encryptJsonField,
    encryptText,
} from "@/lib/encryption/fields";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

type IdContext = { params: Promise<{ id: string }> };

export const POST = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;
    const body = await request.json().catch(() => ({}));
    const presetId = (body.preset as string) || undefined;
    // Optional per-request overrides from the Generate / Re-generate menu.
    // When absent, we fall back to the user's default enhancement provider
    // and that provider's default model (legacy behavior).
    const overrideProviderId =
        typeof body.providerId === "string" && body.providerId.trim()
            ? body.providerId.trim()
            : undefined;
    const overrideModel =
        typeof body.model === "string" && body.model.trim()
            ? body.model.trim()
            : undefined;
    const overrideLanguage =
        typeof body.language === "string" && body.language.trim()
            ? body.language.trim()
            : undefined;

    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, id),
                eq(transcriptions.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!transcription) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "No transcription available. Transcribe the recording first.",
            400,
        );
    }

    const [userSettingsRow] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    let promptConfig: SummaryPromptConfiguration =
        getDefaultSummaryPromptConfig();
    if (userSettingsRow?.summaryPrompt) {
        const config =
            decryptJsonField<SummaryPromptConfiguration>(
                userSettingsRow.summaryPrompt,
            ) ?? getDefaultSummaryPromptConfig();
        promptConfig = {
            selectedPrompt: config.selectedPrompt || "general",
            customPrompts: config.customPrompts || [],
        };
    }

    const selectedPreset = presetId || promptConfig.selectedPrompt || "general";
    let promptTemplate = getSummaryPromptById(selectedPreset, promptConfig);

    if (!promptTemplate) {
        const defaultConfig = getDefaultSummaryPromptConfig();
        promptTemplate = getSummaryPromptById(
            defaultConfig.selectedPrompt,
            defaultConfig,
        );
        if (!promptTemplate) {
            throw new AppError(
                ErrorCode.INTERNAL_ERROR,
                "Failed to load summary prompt",
                500,
            );
        }
    }

    // Provider selection precedence:
    //   1. Explicit `providerId` override from the Re-generate menu
    //      (user-scoped lookup by id).
    //   2. The user's default *enhancement* provider.
    //   3. Fall back to the default *transcription* provider so a user
    //      who only configured one provider can still summarize.
    let credentials: typeof apiCredentials.$inferSelect | undefined;

    if (overrideProviderId) {
        const [chosen] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, overrideProviderId),
                    eq(apiCredentials.userId, session.user.id),
                ),
            )
            .limit(1);
        credentials = chosen;

        if (!credentials) {
            throw new AppError(
                ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
                "The selected AI provider could not be found",
                400,
            );
        }
    } else {
        const [enhancementCredentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, session.user.id),
                    eq(apiCredentials.isDefaultEnhancement, true),
                ),
            )
            .limit(1);

        const [transcriptionCredentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, session.user.id),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        credentials = enhancementCredentials || transcriptionCredentials;
    }

    if (!credentials) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "No AI provider configured",
            400,
        );
    }

    let apiKey: string;
    try {
        apiKey = decrypt(credentials.apiKey);
    } catch {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            `Could not decrypt the API key for provider "${credentials.provider}". The encryption key may have changed. Re-enter the API key in Settings → AI Providers.`,
            500,
        );
    }

    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    // Model selection precedence:
    //   1. Explicit `model` override from the Re-generate menu — the user
    //      hand-picked it, so respect it verbatim (even if unusual).
    //   2. The provider's configured default model.
    //   3. A safe chat default.
    // The whisper→chat fallback only applies to (2)/(3): a transcription
    // model can't drive chat-completions, but if the user explicitly chose
    // a model we don't second-guess it.
    let model = overrideModel || credentials.defaultModel || "gpt-4o-mini";
    if (!overrideModel && model.includes("whisper")) {
        // Pick a lightweight chat model appropriate for the provider
        const baseUrl = credentials.baseUrl || "";
        if (baseUrl.includes("groq")) {
            model = "llama-3.1-8b-instant";
        } else if (baseUrl.includes("together")) {
            model = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
        } else if (baseUrl.includes("openrouter")) {
            model = "openai/gpt-4o-mini";
        } else {
            model = "gpt-4o-mini";
        }
    }

    // Decrypt the transcript before sending it to the LLM. Plaintext is
    // the LLM's input contract; ciphertext lives only in the DB.
    let transcriptText = "";
    try {
        transcriptText = decryptText(transcription.text);
    } catch (error) {
        console.error(
            "Failed to decrypt transcription text for summarization:",
            error,
        );
        transcriptText = "[Decryption Failed - Key Mismatch]";
    }

    // Truncate transcription if too long
    const maxLength = 8000;
    const truncatedTranscription =
        transcriptText.length > maxLength
            ? `${transcriptText.substring(0, maxLength)}...`
            : transcriptText;

    // Apply AI output language directive (if configured) via the system
    // message rather than the user prompt. This separates concerns: the
    // user prompt carries the JSON-shape contract (English keys), the
    // system message carries the output-language preference. Smaller
    // models tend to honor this split more reliably than a combined
    // prompt where language and JSON-shape rules compete.
    // Per-request language override (from the Re-generate menu) wins over
    // the user's saved default. "auto" / empty falls through to the saved
    // preference (which itself may be "match transcript").
    const languageDirective = getAiOutputLanguageDirective(
        overrideLanguage && overrideLanguage !== "auto"
            ? overrideLanguage
            : (userSettingsRow?.aiOutputLanguage ?? null),
    );

    const prompt = promptTemplate.replace(
        "{transcription}",
        truncatedTranscription,
    );

    const baseSystem =
        "You are a helpful assistant that summarizes audio transcriptions. Always respond with valid JSON only, no markdown formatting or code fences.";
    const systemContent = languageDirective
        ? `${baseSystem} ${languageDirective}`
        : baseSystem;

    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: "system",
                content: systemContent,
            },
            {
                role: "user",
                content: prompt,
            },
        ],
        temperature: 0.5,
        max_tokens: 2000,
    });

    const rawContent = response.choices[0]?.message?.content?.trim() || "";

    // Parse the JSON response
    let summary = "";
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    try {
        // Strip markdown code fences if present
        const cleanContent = rawContent
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        const parsed = JSON.parse(cleanContent);
        summary = parsed.summary || "";
        keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
        actionItems = Array.isArray(parsed.actionItems)
            ? parsed.actionItems
            : [];
    } catch {
        // Fallback: treat entire response as summary text
        summary = rawContent;
    }

    // Atomic tombstone re-check + upsert.
    //
    // The user may have deleted the recording while the (long-running)
    // provider call was in flight. To prevent a delete that lands
    // *between* our re-check and our upsert from being silently undone,
    // we run both inside a single transaction that takes a row-level
    // write lock (`FOR UPDATE`) on the recording. The DELETE handler's
    // transaction acquires the same lock via its `UPDATE recordings`
    // tombstone write, so the two transactions serialize: either we
    // see `deletedAt` set and abort, or our upsert commits before
    // DELETE runs and DELETE then cleans up our row inside its own tx.
    // See PR #72.
    const RECORDING_TOMBSTONED = Symbol("recording-tombstoned");
    try {
        await db.transaction(async (tx) => {
            const [stillActive] = await tx
                .select({ deletedAt: recordings.deletedAt })
                .from(recordings)
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                    ),
                )
                .for("update")
                .limit(1);

            if (!stillActive || stillActive.deletedAt) {
                throw RECORDING_TOMBSTONED;
            }

            const [existing] = await tx
                .select()
                .from(aiEnhancements)
                .where(
                    and(
                        eq(aiEnhancements.recordingId, id),
                        eq(aiEnhancements.userId, session.user.id),
                    ),
                )
                .limit(1);

            // Encrypt content fields at rest. `summary` is a text column;
            // `keyPoints` / `actionItems` are jsonb columns and are stored
            // as `{ c: <ciphertext> }` envelopes (option (a) from the
            // rollout plan — keeps the schema unchanged).
            const encryptedSummary = encryptText(summary);
            const encryptedKeyPoints = encryptJsonField(keyPoints);
            const encryptedActionItems = encryptJsonField(actionItems);

            if (existing) {
                await tx
                    .update(aiEnhancements)
                    .set({
                        summary: encryptedSummary,
                        keyPoints: encryptedKeyPoints,
                        actionItems: encryptedActionItems,
                        provider: credentials.provider,
                        model,
                    })
                    .where(
                        and(
                            eq(aiEnhancements.id, existing.id),
                            eq(aiEnhancements.userId, session.user.id),
                        ),
                    );
            } else {
                await tx.insert(aiEnhancements).values({
                    recordingId: id,
                    userId: session.user.id,
                    summary: encryptedSummary,
                    keyPoints: encryptedKeyPoints,
                    actionItems: encryptedActionItems,
                    provider: credentials.provider,
                    model,
                });
            }

            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                        isNull(recordings.deletedAt),
                    ),
                );
        });
    } catch (txError) {
        if (txError === RECORDING_TOMBSTONED) {
            throw new AppError(
                ErrorCode.NOT_FOUND,
                "Recording was deleted",
                410,
            );
        }
        throw txError;
    }

    return NextResponse.json({
        summary,
        keyPoints,
        actionItems,
        provider: credentials.provider,
        model,
    });
});

// GET - Fetch existing summary
export const GET = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    // Dev-only short-circuit for the `/dev/demo-dashboard` screenshot
    // route. Two gates -- `NODE_ENV !== production` AND a `demo-` id
    // prefix -- so this branch is literally unreachable in production
    // builds even if a caller invents a `demo-*` id. Never touches the
    // DB, never decrypts, never logs PII. See `src/lib/demo/fixtures.ts`.
    if (process.env.NODE_ENV !== "production" && isDemoRecordingId(id)) {
        const fixture = DEMO_SUMMARIES.get(id);
        if (!fixture) {
            return NextResponse.json({ summary: null });
        }
        return NextResponse.json({
            summary: fixture.summary,
            keyPoints: fixture.keyPoints,
            actionItems: fixture.actionItems,
            provider: fixture.provider,
            model: fixture.model,
        });
    }

    const [recording] = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
            and(
                eq(recordings.id, id),
                eq(recordings.userId, session.user.id),
                isNull(recordings.deletedAt),
            ),
        )
        .limit(1);

    if (!recording) {
        throw new AppError(
            ErrorCode.RECORDING_NOT_FOUND,
            "Recording not found",
            404,
        );
    }

    const [enhancement] = await db
        .select()
        .from(aiEnhancements)
        .where(
            and(
                eq(aiEnhancements.recordingId, id),
                eq(aiEnhancements.userId, session.user.id),
            ),
        )
        .limit(1);

    if (!enhancement) {
        return NextResponse.json({ summary: null });
    }

    // Decrypt content fields before returning to the client. Legacy
    // plaintext rows pass through verbatim during the backfill window.
    let summary: string | null = null;
    try {
        summary = decryptText(enhancement.summary) ?? null;
    } catch (error) {
        console.error("Failed to decrypt summary:", error);
        summary = "[Decryption Failed - Key Mismatch]";
    }

    let keyPoints: string[] | null = null;
    try {
        keyPoints = decryptJsonField<string[]>(enhancement.keyPoints);
    } catch (error) {
        console.error("Failed to decrypt keyPoints:", error);
    }

    let actionItems: string[] | null = null;
    try {
        actionItems = decryptJsonField<string[]>(enhancement.actionItems);
    } catch (error) {
        console.error("Failed to decrypt actionItems:", error);
    }

    return NextResponse.json({
        summary,
        keyPoints,
        actionItems,
        provider: enhancement.provider,
        model: enhancement.model,
        createdAt: enhancement.createdAt,
    });
});

// DELETE - Remove summary
export const DELETE = apiHandler<IdContext>(async (request, context) => {
    const session = await requireApiSession(request);

    const { id } = await (context as IdContext).params;

    await db.transaction(async (tx) => {
        const deleted = await tx
            .delete(aiEnhancements)
            .where(
                and(
                    eq(aiEnhancements.recordingId, id),
                    eq(aiEnhancements.userId, session.user.id),
                ),
            )
            .returning({ id: aiEnhancements.id });

        if (deleted.length > 0) {
            await tx
                .update(recordings)
                .set({ updatedAt: new Date() })
                .where(
                    and(
                        eq(recordings.id, id),
                        eq(recordings.userId, session.user.id),
                        isNull(recordings.deletedAt),
                    ),
                );
        }
    });

    return NextResponse.json({ success: true });
});
