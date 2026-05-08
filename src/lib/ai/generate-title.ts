import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { decryptJsonField } from "@/lib/encryption/fields";
import {
    getDefaultPromptConfig,
    getPromptById,
    type PromptConfiguration,
} from "./prompt-presets";
import { getAiOutputLanguageDirective } from "./summary-presets";

export async function generateTitleFromTranscription(
    userId: string,
    transcriptionText: string,
): Promise<string | null> {
    try {
        // Get user's prompt configuration
        const [userSettingsRow] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        // Get prompt config. `titleGenerationPrompt` is jsonb-envelope
        // encrypted at rest; legacy plaintext rows pass through verbatim.
        let promptConfig: PromptConfiguration = getDefaultPromptConfig();
        if (userSettingsRow?.titleGenerationPrompt) {
            const config =
                decryptJsonField<PromptConfiguration>(
                    userSettingsRow.titleGenerationPrompt,
                ) ?? getDefaultPromptConfig();
            promptConfig = {
                selectedPrompt: config.selectedPrompt || "default",
                customPrompts: config.customPrompts || [],
            };
        }

        // Get the prompt by ID (preset or custom)
        let promptTemplate = getPromptById(
            promptConfig.selectedPrompt,
            promptConfig,
        );

        if (!promptTemplate) {
            console.warn(
                `Prompt not found: ${promptConfig.selectedPrompt}, using default`,
            );
            const defaultConfig = getDefaultPromptConfig();
            promptTemplate = getPromptById(
                defaultConfig.selectedPrompt,
                defaultConfig,
            );
            if (!promptTemplate) {
                return null;
            }
        }

        // Get user's AI credentials (prefer enhancement provider, fallback to transcription)
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

        const [transcriptionCredentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        // Prefer enhancement provider, fallback to transcription provider
        const credentials = enhancementCredentials || transcriptionCredentials;

        if (!credentials) {
            console.warn("No AI provider found for title generation");
            return null;
        }

        // Decrypt API key
        const apiKey = decrypt(credentials.apiKey);

        // Create OpenAI client
        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        // Use a lightweight model for title generation
        // Prefer chat models (gpt-4o-mini, gpt-3.5-turbo) over Whisper models
        // Fallback to default model if no specific model is set
        let model = credentials.defaultModel || "gpt-4o-mini";

        // If the model is a Whisper model (for transcription), use a chat model instead
        if (model.includes("whisper") || model.includes("whisper-")) {
            model = "gpt-4o-mini";
        }

        // Truncate transcription if too long (to save tokens)
        const maxTranscriptionLength = 2000;
        const truncatedTranscription =
            transcriptionText.length > maxTranscriptionLength
                ? `${transcriptionText.substring(0, maxTranscriptionLength)}...`
                : transcriptionText;

        // Apply AI output language directive (if configured) via the system
        // message rather than the user prompt, so it doesn't compete with
        // the title-format rules in the user prompt.
        const languageDirective = getAiOutputLanguageDirective(
            userSettingsRow?.aiOutputLanguage ?? null,
        );

        const prompt = promptTemplate.replace(
            "{transcription}",
            truncatedTranscription,
        );

        const baseSystem =
            "You are a helpful assistant that generates concise, descriptive titles for audio recordings based on transcriptions. Always follow the rules strictly.";
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
            temperature: 0.7,
            max_tokens: 50, // Titles should be short
        });

        const title = response.choices[0]?.message?.content?.trim() || null;

        if (!title) {
            return null;
        }

        // Clean up the title (remove quotes, colons, etc. if AI didn't follow rules)
        let cleanedTitle = title
            .replace(/^["']|["']$/g, "") // Remove surrounding quotes
            .replace(/[:;]/g, "") // Remove colons and semicolons
            .trim();

        // Enforce 60 character limit
        if (cleanedTitle.length > 60) {
            cleanedTitle = `${cleanedTitle.substring(0, 57)}...`;
        }

        return cleanedTitle || null;
    } catch (error) {
        console.error("Error generating title:", error);
        return null;
    }
}
