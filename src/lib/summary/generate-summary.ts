import { and, eq, isNull } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import {
    apiCredentials,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { buildChatCompletionParams } from "@/lib/ai/chat-completion-params";
import {
    getAiOutputLanguageDirective,
    getDefaultSummaryPromptConfig,
    getSummaryPromptById,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";
import { decrypt } from "@/lib/encryption";
import { decryptJsonField, decryptText } from "@/lib/encryption/fields";
import { AppError, ErrorCode } from "@/lib/errors";
import { captureServerEvent } from "@/lib/posthog-server";
import { upsertEnhancement } from "@/lib/transcription/persist";

export interface GenerateSummaryOptions {
    /**
     * Preset id to use for this run. Overrides the user's default
     * `summaryPrompt.selectedPrompt`. When omitted, falls back to the
     * user's saved preset (which itself falls back to "general").
     */
    presetId?: string;
    /** Analytics `trigger` property on the `summary_generated` event. */
    trigger?: "manual" | "auto";
}

export interface GenerateSummaryResult {
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    provider: string;
    model: string;
    /** Prompt id actually used. Can differ from the requested preset. */
    promptId: string;
    /**
     * True when the requested/saved prompt id couldn't be resolved (e.g. a
     * custom prompt deleted from another tab) and generation fell back to
     * the default prompt instead.
     */
    promptFallback: boolean;
}

/** Coarse length bucket -- never send raw transcript length or content. */
function bucketLength(chars: number): string {
    if (chars < 2_000) return "short";
    if (chars < 10_000) return "medium";
    if (chars < 50_000) return "long";
    return "very_long";
}

/**
 * Generate (or regenerate) a summary for a recording and persist it via
 * the shared `upsertEnhancement` tombstone-aware upsert. Shared by the
 * manual `/api/recordings/[id]/summary` POST handler and the auto-summarize
 * path that runs after a successful transcription.
 *
 * Throws `AppError` on user-facing failures (no transcript, no provider,
 * tombstoned recording). Provider errors propagate verbatim so callers
 * can decide whether to retry or surface them.
 */
export async function generateSummaryForRecording(
    userId: string,
    recordingId: string,
    opts: GenerateSummaryOptions = {},
): Promise<GenerateSummaryResult> {
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(
                eq(recordings.id, recordingId),
                eq(recordings.userId, userId),
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

    // NOTE: when both a Plaud-imported and the user's own transcript coexist,
    // this currently summarizes whichever the DB returns first. Selecting the
    // user's *active* transcript is handled in the Phase 5 UI work (#204).
    const [transcription] = await db
        .select()
        .from(transcriptions)
        .where(
            and(
                eq(transcriptions.recordingId, recordingId),
                eq(transcriptions.userId, userId),
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
        .where(eq(userSettings.userId, userId))
        .limit(1);

    let promptConfig: SummaryPromptConfiguration =
        getDefaultSummaryPromptConfig();
    if (userSettingsRow?.summaryPrompt) {
        // `summaryPrompt` is jsonb-envelope encrypted at rest. Decrypt
        // (legacy plaintext rows pass through verbatim) before reading
        // the user's prompt configuration.
        const config =
            decryptJsonField<SummaryPromptConfiguration>(
                userSettingsRow.summaryPrompt,
            ) ?? getDefaultSummaryPromptConfig();
        promptConfig = {
            selectedPrompt: config.selectedPrompt || "general",
            customPrompts: config.customPrompts || [],
        };
    }

    // Preset resolution: explicit override > user default > "general".
    const selectedPreset =
        opts.presetId || promptConfig.selectedPrompt || "general";
    let promptTemplate = getSummaryPromptById(selectedPreset, promptConfig);

    // Tracks the prompt id actually used, which can differ from
    // `selectedPreset` below (e.g. the request or the saved default
    // pointed at a custom prompt that was since deleted). Returned to the
    // caller so it can warn instead of silently generating with a
    // different prompt than the one requested.
    let usedPromptId = selectedPreset;

    if (!promptTemplate) {
        const defaultConfig = getDefaultSummaryPromptConfig();
        promptTemplate = getSummaryPromptById(
            defaultConfig.selectedPrompt,
            defaultConfig,
        );
        usedPromptId = defaultConfig.selectedPrompt;
        if (!promptTemplate) {
            throw new AppError(
                ErrorCode.INTERNAL_ERROR,
                "Failed to load summary prompt",
                500,
            );
        }
    }

    // Credentials: prefer the user's enhancement-default provider, fall
    // back to any configured provider.
    const [enhancementCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.isDefaultEnhancement, true),
            ),
        )
        .limit(1);

    const [fallbackCredentials] = await db
        .select()
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, userId))
        .limit(1);

    const credentials = enhancementCredentials || fallbackCredentials;

    if (!credentials) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "No AI provider configured",
            400,
        );
    }

    const apiKey = decrypt(credentials.apiKey);

    const openai = new OpenAI({
        apiKey,
        baseURL: credentials.baseUrl || undefined,
    });

    // The configured "default model" on apiCredentials can be a Whisper
    // (transcription-only) id when the user only set up a transcription
    // provider. Pick a sane lightweight chat model per provider in that
    // case so summarization still works.
    let model = credentials.defaultModel || "gpt-4o-mini";
    if (model.includes("whisper")) {
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
    const transcriptText = decryptText(transcription.text);

    // Apply AI output language directive (if configured) via the system
    // message rather than the user prompt. This separates concerns: the
    // user prompt carries the JSON-shape contract (English keys), the
    // system message carries the output-language preference. Smaller
    // models tend to honor this split more reliably than a combined
    // prompt where language and JSON-shape rules compete.
    const languageDirective = getAiOutputLanguageDirective(
        userSettingsRow?.aiOutputLanguage ?? null,
    );

    // `replaceAll` with a function replacer so (a) a custom prompt that
    // references `{transcription}` more than once gets every occurrence
    // expanded, and (b) `$` sequences in the transcript (e.g. `$1`, `$&`)
    // are inserted verbatim instead of being interpreted as
    // `String.prototype.replace` special patterns.
    const prompt = promptTemplate.replaceAll(
        "{transcription}",
        () => transcriptText,
    );

    const baseSystem =
        "You are a helpful assistant that summarizes audio transcriptions. Always respond with valid JSON only, no markdown formatting or code fences.";
    const systemContent = languageDirective
        ? `${baseSystem} ${languageDirective}`
        : baseSystem;

    const response = await openai.chat.completions.create(
        buildChatCompletionParams({
            model,
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: prompt },
            ],
            temperature: 0.5,
            maxTokens: 2000,
        }),
    );

    const rawContent = response.choices[0]?.message?.content?.trim() || "";

    let summary = "";
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    try {
        const cleanContent = rawContent
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        const parsed = JSON.parse(cleanContent);
        // If the JSON parses but the `summary` key is missing or empty,
        // treat the entire raw response as the summary text rather than
        // persisting an empty string. Some models (smaller chat models,
        // and providers that wrap the shape) return
        // `{ "keyPoints": [...], "actionItems": [...] }` without a
        // `summary` key. Falling back to `rawContent` keeps the recording
        // useful instead of showing a silently blank summary.
        summary =
            typeof parsed.summary === "string" && parsed.summary
                ? parsed.summary
                : rawContent;
        keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
        actionItems = Array.isArray(parsed.actionItems)
            ? parsed.actionItems
            : [];
    } catch {
        summary = rawContent;
    }

    // Persist the riffado-generated summary via the shared, tombstone-aware
    // upsert. Summaries stay single per recording; `source` records the origin.
    const { committed } = await upsertEnhancement({
        userId,
        recordingId,
        summary,
        keyPoints,
        actionItems,
        source: "riffado",
        provider: credentials.provider,
        model,
    });

    if (!committed) {
        throw new AppError(ErrorCode.NOT_FOUND, "Recording was deleted", 410);
    }

    await captureServerEvent({
        distinctId: userId,
        event: "summary_generated",
        properties: {
            trigger: opts.trigger ?? "manual",
            provider: credentials.provider,
            transcript_length_bucket: bucketLength(transcriptText.length),
        },
    });

    return {
        summary,
        keyPoints,
        actionItems,
        provider: credentials.provider,
        model,
        promptId: usedPromptId,
        promptFallback: usedPromptId !== selectedPreset,
    };
}
