import { describe, expect, it } from "vitest";
import {
    findPreset,
    getTranscriptionStyle,
    getVisiblePresets,
    isLocalPreset,
    LOCAL_PRESET_NAMES,
    PROVIDER_PRESETS,
    supportsEnhancement,
    supportsTranscription,
    usesChatGptSignIn,
} from "@/lib/ai/provider-presets";

describe("provider-presets", () => {
    describe("visibility", () => {
        it("shows all presets on self-host and hides local + self-host-only presets on hosted", () => {
            expect(getVisiblePresets({ isHosted: false })).toEqual(
                PROVIDER_PRESETS,
            );
            expect(getVisiblePresets({ isHosted: true })).toEqual(
                PROVIDER_PRESETS.filter(
                    (p) => !LOCAL_PRESET_NAMES.has(p.name) && !p.selfHostOnly,
                ),
            );
        });

        it("never offers ChatGPT plan usage on hosted", () => {
            const hosted = getVisiblePresets({ isHosted: true });
            expect(hosted.some((p) => p.name === "ChatGPT")).toBe(false);
            const selfHost = getVisiblePresets({ isHosted: false });
            expect(selfHost.some((p) => p.name === "ChatGPT")).toBe(true);
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
    });

    describe("ChatGPT plan usage preset", () => {
        it("is enhancement-only and signs in with ChatGPT", () => {
            expect(supportsEnhancement("ChatGPT")).toBe(true);
            expect(supportsTranscription("ChatGPT")).toBe(false);
            expect(usesChatGptSignIn("ChatGPT")).toBe(true);
        });

        it("leaves other providers able to transcribe", () => {
            for (const preset of PROVIDER_PRESETS) {
                if (preset.name === "ChatGPT") continue;
                expect(supportsTranscription(preset.name)).toBe(true);
                expect(usesChatGptSignIn(preset.name)).toBe(false);
            }
            expect(supportsTranscription("Some Custom Name")).toBe(true);
        });
    });
});
