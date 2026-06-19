/**
 * Pins the storage and resolver contract that the issue #199 feature
 * depends on:
 *
 *   - `SummaryPromptConfiguration` (the JSON shape stored in
 *     `userSettings.summaryPrompt`) round-trips losslessly through
 *     `encryptJsonField` / `decryptJsonField` with a populated
 *     `customPrompts` array. If this regresses, every custom summary
 *     prompt a user has saved becomes unreadable on the next request.
 *
 *   - `getSummaryPromptById` resolves both built-in preset ids and
 *     user-created custom ids to the underlying prompt template
 *     string. The summary route's only resolution path is
 *     `presetId || promptConfig.selectedPrompt`, both of which fall
 *     through `getSummaryPromptById`. If this regresses, custom
 *     prompts become unreachable even though they're stored.
 *
 *   - Unknown ids return null so the route's "fall back to general"
 *     guard fires instead of crashing.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

const { decryptJsonField, encryptJsonField } = await import(
    "../lib/encryption/fields"
);
const { SUMMARY_PRESETS, getSummaryPromptById, getDefaultSummaryPromptConfig } =
    await import("../lib/ai/summary-presets");

import type {
    CustomSummaryPrompt,
    SummaryPromptConfiguration,
} from "../lib/ai/summary-presets";

const CUSTOM_PROMPTS: CustomSummaryPrompt[] = [
    {
        id: "abc123XYZxxxxxxxxxxxx",
        name: "Detect & format by type",
        prompt: "Summarize this audio. If it's a meeting, list attendees and decisions. If it's a personal note, list highlights. Transcription: {transcription}",
        createdAt: "2026-06-19T10:00:00.000Z",
    },
    {
        id: "def456WVUtttttttttttt",
        name: "Bullet points only",
        prompt: "Return only a bulleted list of the key points from: {transcription}",
        createdAt: "2026-06-19T10:05:00.000Z",
    },
];

const CONFIG_WITH_CUSTOMS: SummaryPromptConfiguration = {
    selectedPrompt: CUSTOM_PROMPTS[0].id,
    customPrompts: CUSTOM_PROMPTS,
};

describe("summaryPrompt config — encryption round-trip", () => {
    it("preserves a populated customPrompts array losslessly", () => {
        const envelope = encryptJsonField(CONFIG_WITH_CUSTOMS);
        expect(envelope).toBeTruthy();
        const decoded = decryptJsonField<SummaryPromptConfiguration>(envelope);
        expect(decoded).toEqual(CONFIG_WITH_CUSTOMS);
    });

    it("preserves the default config", () => {
        const envelope = encryptJsonField(getDefaultSummaryPromptConfig());
        const decoded = decryptJsonField<SummaryPromptConfiguration>(envelope);
        expect(decoded).toEqual({
            selectedPrompt: "general",
            customPrompts: [],
        });
    });

    it("passes null through both directions (column-level 'no setting')", () => {
        expect(encryptJsonField(null)).toBeNull();
        expect(decryptJsonField(null)).toBeNull();
    });
});

describe("getSummaryPromptById — resolves presets and customs", () => {
    it("returns the preset prompt for a built-in id", () => {
        const prompt = getSummaryPromptById("general", CONFIG_WITH_CUSTOMS);
        expect(prompt).toBe(SUMMARY_PRESETS.general.prompt);
    });

    it("returns the custom prompt for a stored custom id", () => {
        const prompt = getSummaryPromptById(
            CUSTOM_PROMPTS[0].id,
            CONFIG_WITH_CUSTOMS,
        );
        expect(prompt).toBe(CUSTOM_PROMPTS[0].prompt);
    });

    it("returns the second custom too (not just the first)", () => {
        const prompt = getSummaryPromptById(
            CUSTOM_PROMPTS[1].id,
            CONFIG_WITH_CUSTOMS,
        );
        expect(prompt).toBe(CUSTOM_PROMPTS[1].prompt);
    });

    it("returns null for an unknown id so the route can fall back", () => {
        const prompt = getSummaryPromptById(
            "totally-not-a-real-id",
            CONFIG_WITH_CUSTOMS,
        );
        expect(prompt).toBeNull();
    });

    it("does not crash when the config carries an empty customPrompts array", () => {
        const prompt = getSummaryPromptById(
            "totally-not-a-real-id",
            getDefaultSummaryPromptConfig(),
        );
        expect(prompt).toBeNull();
    });
});
