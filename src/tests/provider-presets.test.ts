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

        it("matches names exactly (transcription routing is unchanged)", () => {
            expect(findPreset("google gemini")).toBeUndefined();
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

        it("does not throw on a non-string provider from bad API input", () => {
            expect(supportsEnhancement(1 as unknown as string)).toBe(true);
            expect(supportsEnhancement(null as unknown as string)).toBe(true);
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
            expect(getEnhancementBaseUrl("Google Gemini", "   ")).toBe(
                GEMINI_OPENAI_URL,
            );
        });

        it("keeps the credential's own URL", () => {
            expect(
                getEnhancementBaseUrl("Google Gemini", "https://proxy.test/v1"),
            ).toBe("https://proxy.test/v1");
            expect(
                getEnhancementBaseUrl(
                    "Groq",
                    " https://api.groq.com/openai/v1 ",
                ),
            ).toBe("https://api.groq.com/openai/v1");
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
                if (
                    !/whisper|parakeet|scribe|transcribe/i.test(
                        preset.defaultModel,
                    )
                )
                    continue;
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
                    "gemini-3.6-flash",
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                ),
            ).toBe("gemini-3.6-flash");
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

        it("uses a Gemini chat model that Google still serves when unset", () => {
            expect(getEnhancementModel("Google Gemini", null)).toBe(
                "gemini-2.5-flash-lite",
            );
            expect(getEnhancementModel("Google Gemini", "  ")).toBe(
                "gemini-2.5-flash-lite",
            );
        });

        it("prefers a known endpoint over a conflicting provider name", () => {
            // The edit dialog can repoint a credential without saving the
            // new provider name, so the URL is where the request really goes.
            expect(
                getEnhancementModel(
                    "OpenAI",
                    "openai/whisper-large-v3",
                    "https://api.together.xyz/v1",
                ),
            ).toBe("meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo");
            expect(
                getEnhancementModel(
                    "OpenAI",
                    "whisper-large-v3-turbo",
                    "https://api.groq.com/openai/v1",
                ),
            ).toBe("qwen/qwen3.8-27b");
            expect(
                getEnhancementModel(
                    "Groq",
                    "whisper-1",
                    "https://openrouter.ai/api/v1",
                ),
            ).toBe("google/gemini-2.5-flash-lite");
        });

        it("keeps the name-based default for an unknown endpoint", () => {
            expect(
                getEnhancementModel(
                    "Groq",
                    "whisper-large-v3-turbo",
                    "https://llm-proxy.example.test/v1",
                ),
            ).toBe("qwen/qwen3.8-27b");
            expect(
                getEnhancementModel("Groq", "whisper-large-v3", "not a url"),
            ).toBe("qwen/qwen3.8-27b");
        });

        it("replaces Gemini ids that Google shut down", () => {
            // gemini-2.0-flash was the preset default, so most Gemini rows
            // store it.
            for (const retired of [
                "gemini-2.0-flash",
                "gemini-2.0-flash-lite",
                "gemini-1.5-flash",
                "gemini-1.5-pro",
            ]) {
                expect(getEnhancementModel("Google Gemini", retired)).toBe(
                    "gemini-2.5-flash-lite",
                );
            }
            expect(
                getEnhancementModel(
                    "Custom",
                    "gemini-2.0-flash",
                    "https://generativelanguage.googleapis.com/v1beta/openai",
                ),
            ).toBe("gemini-2.5-flash-lite");
        });

        it("keeps retired-looking ids on other providers", () => {
            // OpenRouter ids carry a vendor prefix and are not in the list.
            expect(
                getEnhancementModel(
                    "OpenRouter",
                    "google/gemini-2.0-flash-001",
                ),
            ).toBe("google/gemini-2.0-flash-001");
        });

        it("falls back to a service keyword in the URL, as summaries did before", () => {
            expect(
                getEnhancementModel(
                    "Custom",
                    "openai/whisper-large-v3",
                    "https://api.together.ai/v1",
                ),
            ).toBe("meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo");
            expect(
                getEnhancementModel(
                    "Custom",
                    "whisper-large-v3-turbo",
                    "https://gateway.ai.cloudflare.com/v1/acct/gw/groq",
                ),
            ).toBe("qwen/qwen3.8-27b");
            // Whole labels or segments only.
            expect(
                getEnhancementModel(
                    "Custom",
                    "whisper-1",
                    "https://worktogether.example.com/v1",
                ),
            ).toBe("gpt-4o-mini");
            expect(
                getEnhancementModel(
                    "Custom",
                    "whisper-1",
                    "https://my-groq-proxy.example.com/v1",
                ),
            ).toBe("qwen/qwen3.8-27b");
            // A named provider at an unknown proxy keeps its own defaults,
            // even when the URL names another service.
            expect(
                getEnhancementModel(
                    "OpenAI",
                    "whisper-1",
                    "https://gateway.ai.cloudflare.com/v1/acct/gw/groq",
                ),
            ).toBe("gpt-4o-mini");
            expect(
                getEnhancementModel(
                    "OpenAI",
                    "whisper-1",
                    "https://gateway.ai.cloudflare.com/v1/acct/gw/openai",
                ),
            ).toBe("gpt-4o-mini");
        });

        it("does not throw on non-string inputs", () => {
            expect(
                getEnhancementModel(
                    1 as unknown as string,
                    7 as unknown as string,
                    {} as unknown as string,
                ),
            ).toBe("gpt-4o-mini");
            expect(
                getEnhancementBaseUrl(1 as unknown as string, null),
            ).toBeUndefined();
        });

        it("resolves Google's OpenAI-compatible endpoint under Custom", () => {
            expect(
                getEnhancementModel(
                    "Custom",
                    null,
                    "https://generativelanguage.googleapis.com/v1beta/openai/",
                ),
            ).toBe("gemini-2.5-flash-lite");
        });

        it("keeps a chat fine-tune whose name contains 'scribe'", () => {
            expect(
                getEnhancementModel(
                    "OpenAI",
                    "ft:gpt-4o-mini:acme:describe-v1",
                ),
            ).toBe("ft:gpt-4o-mini:acme:describe-v1");
            expect(getEnhancementModel("Custom", "elevenlabs/scribe_v2")).toBe(
                "gpt-4o-mini",
            );
        });

        it("never returns a transcription id", () => {
            expect(
                getEnhancementModel(
                    "Custom",
                    "scribe_v2",
                    "https://api.elevenlabs.io/v1",
                ),
            ).toBe("gpt-4o-mini");
            expect(getEnhancementModel("ElevenLabs", null)).toBe("gpt-4o-mini");
            for (const preset of PROVIDER_PRESETS) {
                for (const stored of [null, preset.defaultModel]) {
                    expect(
                        getEnhancementModel(
                            preset.name,
                            stored,
                            preset.baseUrl,
                        ),
                    ).not.toMatch(/whisper|parakeet|scribe|transcribe/i);
                }
            }
        });

        it("falls back to gpt-4o-mini for unknown providers with no model", () => {
            expect(getEnhancementModel("Nope", null)).toBe("gpt-4o-mini");
            expect(getEnhancementModel("Nope", "whisper-1")).toBe(
                "gpt-4o-mini",
            );
        });
    });
});
