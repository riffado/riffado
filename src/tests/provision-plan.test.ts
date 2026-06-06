import { describe, expect, test } from "vitest";
import type { DiscoveredService } from "@/lib/ai/local-discovery";
import {
    LOCAL_BYPASS_KEY,
    type ProvisioningContext,
    planProvisioning,
    WHISPER_PLACEHOLDER_KEY,
} from "@/lib/ai/provision-plan";

function svc(over: Partial<DiscoveredService>): DiscoveredService {
    return {
        type: "Ollama",
        host: "127.0.0.1",
        port: 11434,
        baseUrl: "http://127.0.0.1:11434/v1",
        defaultModel: "llama3",
        models: ["llama3"],
        ...over,
    };
}

const FRESH: ProvisioningContext = {
    existingBaseUrls: new Set(),
    hasDefaultTranscription: false,
    hasDefaultEnhancement: false,
};

describe("planProvisioning — Open WebUI is detect-but-don't-provision", () => {
    test("Open WebUI is reported as manual and never inserted", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "Open WebUI",
                    baseUrl: "http://127.0.0.1:8080/api",
                    models: [],
                }),
            ],
            FRESH,
        );
        expect(plan.inserts).toHaveLength(0);
        expect(plan.manual).toEqual(["Open WebUI"]);
        expect(plan.found).toEqual(["Open WebUI"]);
    });

    test("an already-configured Open WebUI is neither inserted nor flagged manual", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "Open WebUI",
                    baseUrl: "http://127.0.0.1:8080/api",
                    models: [],
                }),
            ],
            {
                ...FRESH,
                existingBaseUrls: new Set(["http://127.0.0.1:8080/api"]),
            },
        );
        expect(plan.inserts).toHaveLength(0);
        expect(plan.manual).toEqual([]);
        expect(plan.found).toEqual(["Open WebUI"]);
    });

    test("Open WebUI alongside an Ollama: Ollama provisioned, Open WebUI manual", () => {
        const plan = planProvisioning(
            [
                svc({ type: "Ollama" }),
                svc({
                    type: "Open WebUI",
                    baseUrl: "http://127.0.0.1:8080/api",
                    models: [],
                }),
            ],
            FRESH,
        );
        expect(plan.inserts.map((i) => i.type)).toEqual(["Ollama"]);
        expect(plan.manual).toEqual(["Open WebUI"]);
        expect(plan.found).toEqual(["Ollama", "Open WebUI"]);
    });
});

describe("planProvisioning — keys & default roles", () => {
    test("Faster Whisper provisions with the placeholder key + default transcription", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "Faster Whisper",
                    baseUrl: "http://127.0.0.1:8397/v1",
                    models: ["whisper-1"],
                }),
            ],
            FRESH,
        );
        expect(plan.inserts).toHaveLength(1);
        expect(plan.inserts[0]?.apiKey).toBe(WHISPER_PLACEHOLDER_KEY);
        expect(plan.inserts[0]?.isDefaultTranscription).toBe(true);
        expect(plan.inserts[0]?.isDefaultEnhancement).toBe(false);
    });

    test("WhisperX provisions with the placeholder key + default transcription", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "WhisperX",
                    baseUrl: "http://127.0.0.1:8398/v1",
                    models: ["large-v3-turbo-diarize"],
                }),
            ],
            FRESH,
        );
        expect(plan.inserts).toHaveLength(1);
        expect(plan.inserts[0]?.apiKey).toBe(WHISPER_PLACEHOLDER_KEY);
        expect(plan.inserts[0]?.isDefaultTranscription).toBe(true);
        expect(plan.inserts[0]?.isDefaultEnhancement).toBe(false);
    });

    test("Whisper does NOT claim the transcription default when one already exists", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "Faster Whisper",
                    baseUrl: "http://127.0.0.1:8397/v1",
                }),
            ],
            { ...FRESH, hasDefaultTranscription: true },
        );
        expect(plan.inserts[0]?.isDefaultTranscription).toBe(false);
    });

    test("Ollama uses the bypass key and claims the enhancement default", () => {
        const plan = planProvisioning([svc({ type: "Ollama" })], FRESH);
        expect(plan.inserts[0]?.apiKey).toBe(LOCAL_BYPASS_KEY);
        expect(plan.inserts[0]?.isDefaultEnhancement).toBe(true);
    });

    test("only the first enhancement-capable service claims the default", () => {
        const plan = planProvisioning(
            [
                svc({ type: "Ollama", baseUrl: "http://a:11434/v1" }),
                svc({ type: "LM Studio", baseUrl: "http://b:1234/v1" }),
            ],
            FRESH,
        );
        const enh = plan.inserts.filter((i) => i.isDefaultEnhancement);
        expect(enh).toHaveLength(1);
        expect(enh[0]?.type).toBe("Ollama");
    });

    test("Custom (vLLM etc.) is provisioned but claims no default role", () => {
        const plan = planProvisioning(
            [
                svc({
                    type: "Custom",
                    baseUrl: "http://gpu:8000/v1",
                    models: ["meta-llama/Llama-3"],
                }),
            ],
            FRESH,
        );
        expect(plan.inserts).toHaveLength(1);
        expect(plan.inserts[0]?.isDefaultTranscription).toBe(false);
        expect(plan.inserts[0]?.isDefaultEnhancement).toBe(false);
        expect(plan.inserts[0]?.apiKey).toBe(LOCAL_BYPASS_KEY);
    });
});

describe("planProvisioning — dedupe & existing", () => {
    test("skips a service whose baseUrl is already configured", () => {
        const plan = planProvisioning([svc({ type: "Ollama" })], {
            ...FRESH,
            existingBaseUrls: new Set(["http://127.0.0.1:11434/v1"]),
        });
        expect(plan.inserts).toHaveLength(0);
        expect(plan.found).toEqual(["Ollama"]);
    });

    test("guards against two discovered endpoints sharing a baseUrl in one scan", () => {
        const plan = planProvisioning(
            [
                svc({ type: "Ollama", baseUrl: "http://dup:11434/v1" }),
                svc({ type: "Ollama", baseUrl: "http://dup:11434/v1" }),
            ],
            FRESH,
        );
        expect(plan.inserts).toHaveLength(1);
    });

    test("does not mutate the caller's existingBaseUrls set", () => {
        const existing = new Set<string>();
        planProvisioning([svc({ type: "Ollama" })], {
            ...FRESH,
            existingBaseUrls: existing,
        });
        expect(existing.size).toBe(0);
    });

    test("found is de-duplicated across repeated types", () => {
        const plan = planProvisioning(
            [
                svc({ type: "Ollama", baseUrl: "http://a:11434/v1" }),
                svc({ type: "Ollama", baseUrl: "http://b:11434/v1" }),
            ],
            FRESH,
        );
        expect(plan.found).toEqual(["Ollama"]);
    });
});
