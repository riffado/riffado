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

    describe("knownTranscriptionModels", () => {
        it("OpenAI includes whisper-1 plus the gpt-4o-transcribe family", () => {
            const models = findPreset("OpenAI")?.knownTranscriptionModels;
            expect(models).toEqual([
                "whisper-1",
                "gpt-4o-transcribe",
                "gpt-4o-mini-transcribe",
                "gpt-4o-transcribe-diarize",
            ]);
        });

        it("Groq lists current Whisper Large v3 models (no distil)", () => {
            const models = findPreset("Groq")?.knownTranscriptionModels;
            expect(models).toEqual([
                "whisper-large-v3-turbo",
                "whisper-large-v3",
            ]);
        });

        it("Together AI uses the correct prefixed Whisper id", () => {
            // Regression: the preset default used to be `whisper-large-v3`
            // (no prefix), which 404s on Together AI. Their actual id is
            // `openai/whisper-large-v3` per the audio section of
            // docs.together.ai/docs/serverless-models.
            const preset = findPreset("Together AI");
            expect(preset?.defaultModel).toBe("openai/whisper-large-v3");
            expect(preset?.knownTranscriptionModels).toEqual([
                "openai/whisper-large-v3",
                "nvidia/parakeet-tdt-0.6b-v3",
            ]);
        });

        it("local + custom presets have no curated list (freeform input)", () => {
            expect(
                findPreset("LM Studio")?.knownTranscriptionModels,
            ).toBeUndefined();
            expect(
                findPreset("Ollama")?.knownTranscriptionModels,
            ).toBeUndefined();
            expect(
                findPreset("Custom")?.knownTranscriptionModels,
            ).toBeUndefined();
        });

        it("every defaultModel appears in its preset's known list when one exists", () => {
            for (const p of PROVIDER_PRESETS) {
                if (!p.knownTranscriptionModels) continue;
                expect(p.knownTranscriptionModels).toContain(p.defaultModel);
            }
        });
    });
});
