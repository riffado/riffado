import { describe, expect, it } from "vitest";
import {
    getAllSummaryPrompts,
    getSummaryPromptById,
    isValidSummaryPromptConfig,
} from "@/lib/ai/summary-presets";

// Regression coverage for #199: custom summary prompts were unreachable in
// the UI, and the one path that could write them (`PUT /api/settings/user`)
// accepted any shape and silently wiped `customPrompts` on every preset
// change. These tests cover the shape validator added to close that gap and
// the merge/resolve helpers the UI now relies on.
describe("isValidSummaryPromptConfig", () => {
    it("accepts a well-formed config with no custom prompts", () => {
        expect(
            isValidSummaryPromptConfig({
                selectedPrompt: "general",
                customPrompts: [],
            }),
        ).toBe(true);
    });

    it("accepts a well-formed config with custom prompts", () => {
        expect(
            isValidSummaryPromptConfig({
                selectedPrompt: "custom-1",
                customPrompts: [
                    {
                        id: "custom-1",
                        name: "Recording Type Detector",
                        prompt: "Detect the type... {transcription}",
                        createdAt: "2026-01-01T00:00:00.000Z",
                    },
                ],
            }),
        ).toBe(true);
    });

    it("rejects a missing selectedPrompt", () => {
        expect(isValidSummaryPromptConfig({ customPrompts: [] })).toBe(false);
    });

    it("rejects a non-array customPrompts", () => {
        expect(
            isValidSummaryPromptConfig({
                selectedPrompt: "general",
                customPrompts: "not-an-array",
            }),
        ).toBe(false);
    });

    it("rejects a custom prompt entry missing required fields", () => {
        expect(
            isValidSummaryPromptConfig({
                selectedPrompt: "custom-1",
                customPrompts: [{ id: "custom-1", name: "Missing prompt" }],
            }),
        ).toBe(false);
    });

    it("rejects primitives and null", () => {
        expect(isValidSummaryPromptConfig(null)).toBe(false);
        expect(isValidSummaryPromptConfig("general")).toBe(false);
        expect(isValidSummaryPromptConfig(42)).toBe(false);
    });
});

describe("getAllSummaryPrompts", () => {
    it("merges presets and custom prompts, tagging isPreset correctly", () => {
        const merged = getAllSummaryPrompts({
            selectedPrompt: "custom-1",
            customPrompts: [
                {
                    id: "custom-1",
                    name: "My Custom Prompt",
                    prompt: "Custom instructions {transcription}",
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        });

        const presetIds = merged.filter((p) => p.isPreset).map((p) => p.id);
        expect(presetIds).toEqual(
            expect.arrayContaining([
                "general",
                "meeting-notes",
                "key-points",
                "action-items",
            ]),
        );

        const custom = merged.find((p) => p.id === "custom-1");
        expect(custom).toBeDefined();
        expect(custom?.isPreset).toBe(false);
        expect(custom?.name).toBe("My Custom Prompt");
    });
});

describe("getSummaryPromptById", () => {
    it("resolves a custom prompt id from the config", () => {
        const config = {
            selectedPrompt: "custom-1",
            customPrompts: [
                {
                    id: "custom-1",
                    name: "My Custom Prompt",
                    prompt: "Custom instructions {transcription}",
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        };

        expect(getSummaryPromptById("custom-1", config)).toBe(
            "Custom instructions {transcription}",
        );
    });

    it("returns null for a deleted/unknown custom prompt id -- the route falls back to the default prompt in this case", () => {
        const config = { selectedPrompt: "general", customPrompts: [] };
        expect(getSummaryPromptById("deleted-custom-id", config)).toBeNull();
    });
});
