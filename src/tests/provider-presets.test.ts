import { describe, expect, it } from "vitest";
import {
    findPreset,
    getEnhancementBaseUrl,
    getEnhancementModel,
    getTranscriptionStyle,
    getVisiblePresets,
    isLocalPreset,
    LOCAL_PRESET_NAMES,
    PROVIDER_PRESETS,
    supportsEnhancement,
} from "@/lib/ai/provider-presets";

describe("provider-presets", () => {
    describe("visibility", () => {
        it("shows all presets on self-host and only non-local presets on hosted", () => {
            expect(getVisiblePresets({ isHosted: false })).toEqual(
                PROVIDER_PRESETS,
            );
            expect(getVisiblePresets({ isHosted: true })).toEqual(
                PROVIDER_PRESETS.filter((p) => !LOCAL_PRESET_NAMES.has(p.name)),
            );
        });
    });

    describe("isLocalPreset", () => {
        it("matches LOCAL_PRESET_NAMES", () => {
            for (const preset of PROVIDER_PRESETS) {
                expect(isLocalPreset(preset.name)).toBe(
                    LOCAL_PRESET_NAMES.has(preset.name),
                );
            }
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
        it("Together AI uses the correct prefixed Whisper id", () => {
            const preset = findPreset("Together AI");
            expect(preset?.defaultModel).toBe("openai/whisper-large-v3");
            expect(preset?.knownTranscriptionModels).toContain(
                "openai/whisper-large-v3",
            );
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

    describe("ElevenLabs", () => {
        it("uses the elevenlabs transcription style with scribe_v2 as default", () => {
            const preset = findPreset("ElevenLabs");
            expect(preset).toBeDefined();
            expect(preset?.transcriptionStyle).toBe("elevenlabs");
            expect(preset?.defaultModel).toBe("scribe_v2");
            expect(preset?.knownTranscriptionModels).toContain("scribe_v1");
        });

        it("is not a local preset and stays visible on hosted", () => {
            expect(isLocalPreset("ElevenLabs")).toBe(false);
            expect(
                getVisiblePresets({ isHosted: true }).some(
                    (p) => p.name === "ElevenLabs",
                ),
            ).toBe(true);
        });
    });

    describe("getTranscriptionStyle", () => {
        it("resolves 'elevenlabs' for the ElevenLabs preset", () => {
            expect(getTranscriptionStyle("ElevenLabs")).toBe("elevenlabs");
        });
    });

    describe("supportsEnhancement", () => {
        it("is false for ElevenLabs", () => {
            expect(supportsEnhancement("ElevenLabs")).toBe(false);
        });

        it("is true for every other preset", () => {
            for (const preset of PROVIDER_PRESETS) {
                if (preset.name === "ElevenLabs") continue;
                expect(supportsEnhancement(preset.name)).toBe(true);
            }
        });

        it("is true for an unknown/custom provider name", () => {
            expect(supportsEnhancement("Nope")).toBe(true);
        });

        it("matches preset names case-insensitively", () => {
            expect(supportsEnhancement("elevenlabs")).toBe(false);
            expect(supportsEnhancement(" ELEVENLABS ")).toBe(false);
        });
    });

    describe("getEnhancementBaseUrl", () => {
        const GEMINI_OPENAI_URL =
            "https://generativelanguage.googleapis.com/v1beta/openai";

        it("routes a Gemini credential without a URL to Google's OpenAI-compatible endpoint", () => {
            expect(getEnhancementBaseUrl("Google Gemini", null)).toBe(
                GEMINI_OPENAI_URL,
            );
            expect(getEnhancementBaseUrl("google gemini", "")).toBe(
                GEMINI_OPENAI_URL,
            );
        });

        it("keeps the credential's own URL", () => {
            expect(
                getEnhancementBaseUrl("Google Gemini", "https://proxy.test/v1"),
            ).toBe("https://proxy.test/v1");
            expect(
                getEnhancementBaseUrl("Groq", "https://api.groq.com/openai/v1"),
            ).toBe("https://api.groq.com/openai/v1");
        });

        it("leaves the SDK default for presets without an enhancement endpoint", () => {
            expect(getEnhancementBaseUrl("OpenAI", null)).toBeUndefined();
            expect(getEnhancementBaseUrl("Custom", null)).toBeUndefined();
            expect(getEnhancementBaseUrl("Nope", undefined)).toBeUndefined();
        });
    });

    describe("getEnhancementModel", () => {
        it("swaps a Groq Whisper default for a chat model Groq serves", () => {
            expect(getEnhancementModel("Groq", "whisper-large-v3-turbo")).toBe(
                "qwen/qwen3.8-27b",
            );
            expect(getEnhancementModel("Groq", "whisper-large-v3")).not.toBe(
                "gpt-4o-mini",
            );
        });

        it("swaps an unset or transcription model for every curated preset", () => {
            for (const preset of PROVIDER_PRESETS) {
                if (!preset.enhancementModel) continue;
                expect(getEnhancementModel(preset.name, null)).toBe(
                    preset.enhancementModel,
                );
                expect(
                    getEnhancementModel(preset.name, preset.defaultModel),
                ).toBe(preset.enhancementModel);
            }
        });

        it("keeps a chat model that is not a transcription id", () => {
            expect(getEnhancementModel("Groq", "openai/gpt-oss-120b")).toBe(
                "openai/gpt-oss-120b",
            );
            expect(getEnhancementModel("OpenAI", "gpt-4o-mini")).toBe(
                "gpt-4o-mini",
            );
        });

        it("keeps dual-use Gemini chat models", () => {
            expect(
                getEnhancementModel("Google Gemini", "gemini-2.5-flash"),
            ).toBe("gemini-2.5-flash");
            expect(
                getEnhancementModel(
                    "Google Gemini",
                    "gemini-2.0-flash",
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                ),
            ).toBe("gemini-2.0-flash");
        });

        it("matches preset names case-insensitively", () => {
            expect(getEnhancementModel("groq", "whisper-large-v3-turbo")).toBe(
                "qwen/qwen3.8-27b",
            );
            expect(getEnhancementModel("openai", "whisper-1")).toBe(
                "gpt-4o-mini",
            );
        });

        it("swaps transcription-only OpenAI ids", () => {
            expect(getEnhancementModel("OpenAI", "gpt-4o-transcribe")).toBe(
                "gpt-4o-mini",
            );
            expect(
                getEnhancementModel("Custom", "gpt-4o-mini-transcribe"),
            ).toBe("gpt-4o-mini");
        });

        it("resolves a Custom credential by its endpoint", () => {
            expect(
                getEnhancementModel(
                    "Custom",
                    "openai/whisper-large-v3",
                    "https://api.together.xyz/v1",
                ),
            ).toBe("meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo");
            expect(
                getEnhancementModel(
                    "Custom",
                    "whisper-large-v3-turbo",
                    "https://api.groq.com/openai/v1",
                ),
            ).toBe("qwen/qwen3.8-27b");
            expect(
                getEnhancementModel(
                    "Custom",
                    "whisper-1",
                    "http://localhost:1234/v1",
                ),
            ).toBe("gpt-4o-mini");
        });

        it("falls back to the preset default model", () => {
            expect(getEnhancementModel("Google Gemini", null)).toBe(
                "gemini-2.0-flash",
            );
        });

        it("falls back to gpt-4o-mini for unknown providers with no model", () => {
            expect(getEnhancementModel("Nope", null)).toBe("gpt-4o-mini");
            expect(getEnhancementModel("Nope", "whisper-1")).toBe(
                "gpt-4o-mini",
            );
        });
    });
});
