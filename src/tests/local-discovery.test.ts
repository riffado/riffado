import { describe, expect, test } from "vitest";
import {
    classifyOpenAiCompat,
    type DiscoveredService,
    dedupeServices,
    discoverLocalAiServices,
    parseTailscaleHosts,
    pickDefaultModel,
    probeTarget,
    resolveScanPlan,
    WHISPER_PORT,
} from "@/lib/ai/local-discovery";

// --- Fake fetch -------------------------------------------------------------
// Maps an exact URL to a canned response. Any URL not in the map "refuses the
// connection" (throws), mirroring a closed port. The AbortSignal is ignored.
type Route = { status?: number; json?: unknown };
function fakeFetch(routes: Record<string, Route>): typeof fetch {
    return (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        const route = routes[url];
        if (!route) throw new Error(`ECONNREFUSED ${url}`);
        const status = route.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => {
                if (route.json === undefined) throw new Error("not json");
                return route.json;
            },
        } as Response;
    }) as unknown as typeof fetch;
}

describe("parseTailscaleHosts", () => {
    test("extracts self + online peer IPv4s", () => {
        const stdout = JSON.stringify({
            Self: { TailscaleIPs: ["100.64.0.1", "fd7a::1"] },
            Peer: {
                a: {
                    Online: true,
                    HostName: "gpu-box",
                    OS: "linux",
                    TailscaleIPs: ["100.64.0.2"],
                },
                b: {
                    Online: true,
                    HostName: "laptop",
                    OS: "macOS",
                    TailscaleIPs: ["100.64.0.3"],
                },
            },
        });
        expect(parseTailscaleHosts(stdout)).toEqual([
            "100.64.0.1",
            "100.64.0.2",
            "100.64.0.3",
        ]);
    });

    test("skips offline peers, funnel ingress nodes and android devices", () => {
        const stdout = JSON.stringify({
            Self: { TailscaleIPs: ["100.64.0.1"] },
            Peer: {
                off: { Online: false, TailscaleIPs: ["100.64.0.9"] },
                funnel: {
                    Online: true,
                    HostName: "funnel-ingress-node",
                    TailscaleIPs: ["100.64.0.10"],
                },
                phone: {
                    Online: true,
                    OS: "android",
                    TailscaleIPs: ["100.64.0.11"],
                },
            },
        });
        expect(parseTailscaleHosts(stdout)).toEqual(["100.64.0.1"]);
    });

    test("prefers IPv4 and tolerates IPv6-only / malformed input", () => {
        expect(
            parseTailscaleHosts(
                JSON.stringify({
                    Self: { TailscaleIPs: ["fd7a::1"] },
                    Peer: {},
                }),
            ),
        ).toEqual([]);
        expect(parseTailscaleHosts("not json")).toEqual([]);
        expect(parseTailscaleHosts("{}")).toEqual([]);
    });
});

describe("resolveScanPlan", () => {
    test("LLM_HOSTS overrides and suppresses Tailscale peers", () => {
        const plan = resolveScanPlan({ LLM_HOSTS: "10.0.0.5, 10.0.0.6" }, [
            "100.64.0.2",
        ]);
        expect(plan.hosts).toContain("10.0.0.5");
        expect(plan.hosts).toContain("10.0.0.6");
        // Tailscale peer is NOT scanned when LLM_HOSTS is set (route passes []
        // in practice; resolveScanPlan also ignores it directly).
        expect(plan.hosts).not.toContain("100.64.0.2");
    });

    test("uses Tailscale peers when LLM_HOSTS is unset", () => {
        const plan = resolveScanPlan({}, ["100.64.0.2"]);
        expect(plan.hosts).toContain("100.64.0.2");
    });

    test("always appends local + docker fallback hosts", () => {
        const plan = resolveScanPlan({}, []);
        for (const h of ["localhost", "127.0.0.1", "host.docker.internal"]) {
            expect(plan.hosts).toContain(h);
        }
    });

    test("pulls hostname + custom port from provider env URLs", () => {
        const plan = resolveScanPlan(
            {
                OLLAMA_BASE_URL: "http://gpu.local:9999",
                LM_STUDIO_URL: "lm.local:4321",
            },
            [],
        );
        expect(plan.hosts).toContain("gpu.local");
        expect(plan.hosts).toContain("lm.local");
        expect(plan.ports).toContain(9999);
        expect(plan.ports).toContain(4321);
    });

    test("scans the 8000-8020 range plus the well-known ports", () => {
        const plan = resolveScanPlan({}, []);
        for (let p = 8000; p <= 8020; p++) expect(plan.ports).toContain(p);
        expect(plan.ports).toContain(11434);
        expect(plan.ports).toContain(1234);
        expect(plan.ports).toContain(WHISPER_PORT);
        expect(plan.ports).toContain(8398); // WHISPERX_PORT
        expect(plan.ports).toContain(9000); // ASR_WEBSERVICE_PORT
    });

    test("de-duplicates repeated hosts", () => {
        const plan = resolveScanPlan({ LLM_HOSTS: "localhost, localhost" }, []);
        expect(plan.hosts.filter((h) => h === "localhost")).toHaveLength(1);
    });
});

describe("pickDefaultModel", () => {
    test("prefers a whisper-named model when requested", () => {
        expect(
            pickDefaultModel(["llama3", "faster-whisper-large-v3"], true),
        ).toBe("faster-whisper-large-v3");
    });
    test("falls back to the first model", () => {
        expect(pickDefaultModel(["llama3", "qwen"], true)).toBe("llama3");
        expect(pickDefaultModel(["llama3", "qwen"], false)).toBe("llama3");
        expect(pickDefaultModel([], true)).toBe("");
    });
});

describe("classifyOpenAiCompat", () => {
    const base = { host: "h", port: 8000, isLmStudio: false, isOllama: false };

    test("LM Studio and Ollama win on their native signals", () => {
        expect(
            classifyOpenAiCompat({ ...base, models: ["m"], isLmStudio: true })
                .type,
        ).toBe("LM Studio");
        expect(
            classifyOpenAiCompat({ ...base, models: ["m"], isOllama: true })
                .type,
        ).toBe("Ollama");
    });

    test("whisper detected by model name", () => {
        const svc = classifyOpenAiCompat({
            ...base,
            models: ["Systran/faster-whisper-large-v3"],
        });
        expect(svc.type).toBe("Faster Whisper");
        expect(svc.defaultModel).toBe("Systran/faster-whisper-large-v3");
    });

    test("whisper detected by dedicated port 8397", () => {
        expect(
            classifyOpenAiCompat({
                ...base,
                port: WHISPER_PORT,
                models: ["default"],
            }).type,
        ).toBe("Faster Whisper");
    });

    test("whisperx detected by dedicated port 8398 or 9000", () => {
        const svc1 = classifyOpenAiCompat({
            ...base,
            port: 8398,
            models: ["large-v3-turbo"],
        });
        expect(svc1.type).toBe("WhisperX");
        expect(svc1.defaultModel).toBe("large-v3-turbo");

        const svc2 = classifyOpenAiCompat({
            ...base,
            port: 9000,
            models: ["large-v3-turbo-diarize"],
        });
        expect(svc2.type).toBe("WhisperX");
        expect(svc2.defaultModel).toBe("large-v3-turbo-diarize");
    });

    test("whisperx detected by diarize model name and prefers it", () => {
        const svc = classifyOpenAiCompat({
            ...base,
            models: ["large-v3-turbo", "large-v3-turbo-diarize"],
        });
        expect(svc.type).toBe("WhisperX");
        expect(svc.defaultModel).toBe("large-v3-turbo-diarize");
    });

    test("REGRESSION: a vLLM server on port 8000 is Custom, not Faster Whisper", () => {
        const svc = classifyOpenAiCompat({
            ...base,
            port: 8000,
            models: ["meta-llama/Llama-3-8B"],
        });
        expect(svc.type).toBe("Custom");
        expect(svc.baseUrl).toBe("http://h:8000/v1");
    });
});

describe("dedupeServices", () => {
    const mk = (over: Partial<DiscoveredService>): DiscoveredService => ({
        type: "Ollama",
        host: "100.64.0.2",
        port: 11434,
        baseUrl: "http://100.64.0.2:11434/v1",
        defaultModel: "llama3",
        models: ["llama3", "qwen"],
        ...over,
    });

    test("collapses the same machine reached via two IPs (identical model set)", () => {
        const result = dedupeServices([
            mk({ host: "127.0.0.1", baseUrl: "http://127.0.0.1:11434/v1" }),
            mk({ host: "100.64.0.2", baseUrl: "http://100.64.0.2:11434/v1" }),
        ]);
        expect(result).toHaveLength(1);
    });

    test("keeps hosts that serve genuinely different model sets", () => {
        const result = dedupeServices([
            mk({ host: "a", models: ["llama3"] }),
            mk({ host: "b", models: ["mistral"] }),
        ]);
        expect(result).toHaveLength(2);
    });

    test("model-less endpoints (Open WebUI) are keyed by host, not merged", () => {
        const result = dedupeServices([
            mk({
                type: "Open WebUI",
                host: "a",
                models: [],
                baseUrl: "http://a:8080/api",
            }),
            mk({
                type: "Open WebUI",
                host: "b",
                models: [],
                baseUrl: "http://b:8080/api",
            }),
        ]);
        expect(result).toHaveLength(2);
    });
});

describe("probeTarget", () => {
    test("classifies Ollama via /v1/models + /api/tags", async () => {
        const f = fakeFetch({
            "http://h:11434/v1/models": {
                json: { data: [{ id: "llama3" }, { id: "qwen" }] },
            },
            "http://h:11434/api/tags": {
                json: { models: [{ name: "llama3" }] },
            },
            // No /api/v1/models route -> LM Studio signal absent.
        });
        const svc = await probeTarget(f, "h", 11434);
        expect(svc?.type).toBe("Ollama");
        expect(svc?.models).toEqual(["llama3", "qwen"]);
    });

    test("classifies LM Studio via the native /api/v1/models signature", async () => {
        const f = fakeFetch({
            "http://h:1234/v1/models": {
                json: { data: [{ id: "qwen2.5-7b" }] },
            },
            "http://h:1234/api/v1/models": {
                json: {
                    models: [{ key: "qwen2.5-7b", architecture: "qwen2" }],
                },
            },
        });
        const svc = await probeTarget(f, "h", 1234);
        expect(svc?.type).toBe("LM Studio");
    });

    test("REGRESSION: vLLM on :8000 is Custom (not auto-tagged Whisper)", async () => {
        const f = fakeFetch({
            "http://h:8000/v1/models": {
                json: { data: [{ id: "meta-llama/Llama-3-8B" }] },
            },
        });
        const svc = await probeTarget(f, "h", 8000);
        expect(svc?.type).toBe("Custom");
    });

    test("falls back to native Ollama /api/tags when /v1/models is absent", async () => {
        const f = fakeFetch({
            "http://h:11434/api/tags": { json: { models: [{ name: "phi3" }] } },
        });
        const svc = await probeTarget(f, "h", 11434);
        expect(svc?.type).toBe("Ollama");
        expect(svc?.defaultModel).toBe("phi3");
    });

    test("Open WebUI requires a real signature, not just a 200", async () => {
        // A bare 200 with an unrelated JSON body must NOT be classified.
        const decoy = fakeFetch({
            "http://h:8080/api/config": { json: { hello: "world" } },
        });
        expect(await probeTarget(decoy, "h", 8080)).toBeNull();

        const real = fakeFetch({
            "http://h:8080/api/config": {
                json: { name: "Open WebUI", version: "0.5.0", features: {} },
            },
        });
        const svc = await probeTarget(real, "h", 8080);
        expect(svc?.type).toBe("Open WebUI");
        expect(svc?.baseUrl).toBe("http://h:8080/api");
    });

    test("returns null when nothing recognizable answers", async () => {
        expect(await probeTarget(fakeFetch({}), "h", 9000)).toBeNull();
    });
});

describe("discoverLocalAiServices", () => {
    test("scans the plan and de-dupes the same Ollama box across local + Tailscale IPs", async () => {
        const ollama = { json: { data: [{ id: "llama3" }] } };
        const tags = { json: { models: [{ name: "llama3" }] } };
        const f = fakeFetch({
            "http://127.0.0.1:11434/v1/models": ollama,
            "http://127.0.0.1:11434/api/tags": tags,
            "http://100.64.0.2:11434/v1/models": ollama,
            "http://100.64.0.2:11434/api/tags": tags,
        });

        const { services } = await discoverLocalAiServices({
            env: {},
            tailscaleHosts: ["100.64.0.2"],
            fetchImpl: f,
            concurrency: 8,
        });

        expect(services).toHaveLength(1);
        expect(services[0]?.type).toBe("Ollama");
    });
});
