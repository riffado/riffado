import { describe, expect, it } from "vitest";
import {
    findPreset,
    getVisiblePresets,
    isLocalPreset,
    LOCAL_PRESET_NAMES,
    PROVIDER_PRESETS,
} from "@/lib/ai/provider-presets";

describe("provider-presets", () => {
    describe("getVisiblePresets", () => {
        it("returns every preset on self-host", () => {
            const visible = getVisiblePresets({ isHosted: false });
            expect(visible).toEqual(PROVIDER_PRESETS);
        });

        it("hides LM Studio and Ollama on hosted", () => {
            const visible = getVisiblePresets({ isHosted: true });
            const names = visible.map((p) => p.name);
            expect(names).not.toContain("LM Studio");
            expect(names).not.toContain("Ollama");
        });

        it("keeps every non-local preset on hosted", () => {
            const visible = getVisiblePresets({ isHosted: true }).map(
                (p) => p.name,
            );
            expect(visible).toContain("OpenAI");
            expect(visible).toContain("Groq");
            expect(visible).toContain("Together AI");
            expect(visible).toContain("OpenRouter");
            expect(visible).toContain("Custom");
        });
    });

    describe("isLocalPreset", () => {
        it("matches the published LOCAL_PRESET_NAMES set", () => {
            expect(isLocalPreset("LM Studio")).toBe(true);
            expect(isLocalPreset("Ollama")).toBe(true);
            expect(isLocalPreset("OpenAI")).toBe(false);
            expect(isLocalPreset("Custom")).toBe(false);
            expect(LOCAL_PRESET_NAMES.has("LM Studio")).toBe(true);
        });
    });

    describe("findPreset", () => {
        it("returns the preset by name", () => {
            expect(findPreset("OpenAI")?.defaultModel).toBe("whisper-1");
            expect(findPreset("Ollama")?.baseUrl).toBe(
                "http://localhost:11434/v1",
            );
        });

        it("returns undefined for an unknown name", () => {
            expect(findPreset("Nope")).toBeUndefined();
        });
    });
});
