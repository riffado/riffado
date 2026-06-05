import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

const execAsync = promisify(exec);

interface ProbeResult {
    type: "Faster Whisper" | "Ollama" | "Open WebUI" | "LM Studio" | "Custom";
    baseUrl: string;
    defaultModel: string;
    host: string;
    port: number;
}

// Helper to fetch with a timeout
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 1000,
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

interface TailscalePeer {
    Online?: boolean;
    HostName?: string;
    OS?: string;
    TailscaleIPs?: string[];
}

// Query online Tailscale peers and local interface IPs
async function discoverTailscaleHosts(): Promise<string[]> {
    const hosts: string[] = [];
    try {
        const { stdout } = await execAsync("tailscale status --json", {
            timeout: 3000,
        });
        const data = JSON.parse(stdout);

        // Add self
        const selfIps = data?.Self?.TailscaleIPs || [];
        for (const ip of selfIps) {
            if (typeof ip === "string" && ip.includes(".")) {
                hosts.push(ip);
                break;
            }
        }

        // Add peers
        const peers = Object.values(data?.Peer || {});
        for (const peer of peers as TailscalePeer[]) {
            if (!peer.Online) continue;
            if (peer.HostName === "funnel-ingress-node") continue;
            if (peer.OS === "android") continue;
            const peerIps = peer.TailscaleIPs || [];
            for (const ip of peerIps) {
                if (typeof ip === "string" && ip.includes(".")) {
                    hosts.push(ip);
                    break;
                }
            }
        }
    } catch (_err) {
        // Fail silently
    }
    return hosts;
}

// Fingerprint and probe target
async function probeTarget(
    host: string,
    port: number,
): Promise<ProbeResult | null> {
    // 1. Try OpenAI compat endpoint first
    try {
        const res = await fetchWithTimeout(
            `http://${host}:${port}/v1/models`,
            {},
            1000,
        );
        if (res.ok) {
            const data = await res.json();
            const models = data?.data || [];
            const firstModel = models[0]?.id || "";
            if (firstModel) {
                // Fingerprint
                // A. Check LM Studio
                try {
                    const lmRes = await fetchWithTimeout(
                        `http://${host}:${port}/api/v1/models`,
                        {},
                        1000,
                    );
                    if (lmRes.ok) {
                        const lmData = await lmRes.json();
                        const lmModels = lmData?.models || [];
                        if (
                            Array.isArray(lmModels) &&
                            lmModels.length > 0 &&
                            lmModels[0]?.key &&
                            lmModels[0]?.architecture
                        ) {
                            return {
                                type: "LM Studio",
                                baseUrl: `http://${host}:${port}/v1`,
                                defaultModel: firstModel,
                                host,
                                port,
                            };
                        }
                    }
                } catch {}

                // B. Check Ollama
                try {
                    const ollamaRes = await fetchWithTimeout(
                        `http://${host}:${port}/api/tags`,
                        {},
                        1000,
                    );
                    if (ollamaRes.ok) {
                        return {
                            type: "Ollama",
                            baseUrl: `http://${host}:${port}/v1`,
                            defaultModel: firstModel,
                            host,
                            port,
                        };
                    }
                } catch {}

                // C. Check if Faster Whisper
                if (
                    port === 8397 ||
                    port === 8000 ||
                    firstModel.toLowerCase().includes("whisper")
                ) {
                    return {
                        type: "Faster Whisper",
                        baseUrl: `http://${host}:${port}/v1`,
                        defaultModel: firstModel,
                        host,
                        port,
                    };
                }

                // Default Custom OpenAI compat
                return {
                    type: "Custom",
                    baseUrl: `http://${host}:${port}/v1`,
                    defaultModel: firstModel,
                    host,
                    port,
                };
            }
        }
    } catch {}

    // 2. Try Ollama native /api/tags directly
    try {
        const res = await fetchWithTimeout(
            `http://${host}:${port}/api/tags`,
            {},
            1000,
        );
        if (res.ok) {
            const data = await res.json();
            const models = data?.models || [];
            if (models.length > 0) {
                return {
                    type: "Ollama",
                    baseUrl: `http://${host}:${port}/v1`,
                    defaultModel: models[0].name,
                    host,
                    port,
                };
            }
        }
    } catch {}

    // 3. Try Open WebUI /api
    try {
        const res = await fetchWithTimeout(
            `http://${host}:${port}/api/config`,
            {},
            1000,
        );
        if (res.status === 200 || res.status === 401 || res.status === 403) {
            return {
                type: "Open WebUI",
                baseUrl: `http://${host}:${port}/api`,
                defaultModel: "gpt-4o",
                host,
                port,
            };
        }
    } catch {}

    // Try Open WebUI root (no /api)
    try {
        const res = await fetchWithTimeout(
            `http://${host}:${port}/config`,
            {},
            1000,
        );
        if (res.status === 200 || res.status === 401 || res.status === 403) {
            return {
                type: "Open WebUI",
                baseUrl: `http://${host}:${port}`,
                defaultModel: "gpt-4o",
                host,
                port,
            };
        }
    } catch {}

    return null;
}

// Concurrency pool helper
async function pool<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency = 50,
): Promise<R[]> {
    const results: R[] = [];
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const currentIndex = index++;
            try {
                results[currentIndex] = await fn(items[currentIndex]);
            } catch {
                // Ignore errors
            }
        }
    }
    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        worker,
    );
    await Promise.all(workers);
    return results;
}

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    if (env.IS_HOSTED) {
        return NextResponse.json({
            success: true,
            found: [],
            provisioned: [],
        });
    }

    const userId = session.user.id;

    // Get current user's providers to avoid duplicates
    const existingProviders = await db
        .select({
            id: apiCredentials.id,
            provider: apiCredentials.provider,
            baseUrl: apiCredentials.baseUrl,
            isDefaultTranscription: apiCredentials.isDefaultTranscription,
            isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, userId));

    const existingBaseUrls = new Set(
        existingProviders
            .map((p) => p.baseUrl?.toLowerCase().trim())
            .filter(Boolean),
    );

    const hosts = new Set<string>();

    // 1. LLM_HOSTS env var (comma-separated)
    if (env.LLM_HOSTS) {
        for (const h of env.LLM_HOSTS.split(",")) {
            const trimmed = h.trim();
            if (trimmed) hosts.add(trimmed);
        }
    }

    // 2. Extra hosts from other env vars
    const envVarsToCheck = [
        env.OLLAMA_BASE_URL,
        env.OLLAMA_URL,
        env.LM_STUDIO_URL,
    ];
    const extraPorts = new Set<number>();
    for (const urlStr of envVarsToCheck) {
        if (!urlStr) continue;
        try {
            const parsed = new URL(
                urlStr.includes("://") ? urlStr : `http://${urlStr}`,
            );
            if (parsed.hostname) {
                hosts.add(parsed.hostname);
            }
            if (parsed.port) {
                extraPorts.add(parseInt(parsed.port, 10));
            }
        } catch {}
    }

    // 3. Tailscale peer discovery (only if LLM_HOSTS is not set)
    if (!env.LLM_HOSTS) {
        const tsHosts = await discoverTailscaleHosts();
        for (const h of tsHosts) {
            hosts.add(h);
        }
    }

    // 4. Default local & Docker hosts fallback
    const defaultHosts = [
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "whisper",
        "mesynx-ai-whisper",
        "ollama",
        "open-webui",
        "openwebui",
    ];
    for (const h of defaultHosts) {
        hosts.add(h);
    }

    // Ports to check
    const ports = new Set<number>([
        11434, // Ollama
        1234, // LM Studio
        3000, // Open WebUI / App fallback
        8080, // Open WebUI / Ollama / Alternate
        8397, // Default Mesynx AI GPU Whisper port
    ]);

    // Add ports 8000 to 8020
    for (let p = 8000; p <= 8020; p++) {
        ports.add(p);
    }

    // Add custom ports from env vars
    for (const p of extraPorts) {
        ports.add(p);
    }

    // Construct target list
    const targets: { host: string; port: number }[] = [];
    for (const host of hosts) {
        for (const port of ports) {
            targets.push({ host, port });
        }
    }

    // Scan targets in parallel with concurrency pool of 50
    const rawResults = await pool(
        targets,
        ({ host, port }) => probeTarget(host, port),
        50,
    );

    const discovered = rawResults.filter((r): r is ProbeResult => r !== null);

    // Deduplicate discovered hosts by (port, type, defaultModel) to avoid same machine via different routing IPs
    const seenEndpoints = new Set<string>();
    const uniqueDiscovered: ProbeResult[] = [];
    for (const r of discovered) {
        const key = `${r.port}:${r.type}:${r.defaultModel}`;
        if (!seenEndpoints.has(key)) {
            seenEndpoints.add(key);
            uniqueDiscovered.push(r);
        }
    }

    const found: string[] = [];
    const provisioned: string[] = [];

    // Provision discovered targets
    for (const match of uniqueDiscovered) {
        found.push(match.type);
        const alreadyExists = existingBaseUrls.has(
            match.baseUrl.toLowerCase().trim(),
        );
        if (!alreadyExists) {
            const hasDefaultTranscription = existingProviders.some(
                (p) => p.isDefaultTranscription,
            );
            const hasDefaultEnhancement = existingProviders.some(
                (p) => p.isDefaultEnhancement,
            );

            // Determine if this should be default transcription or default enhancement
            const isTranscriptionService = match.type === "Faster Whisper";
            const isDefaultTranscription =
                isTranscriptionService &&
                !hasDefaultTranscription &&
                !provisioned.includes("Faster Whisper");

            const isEnhancementService =
                match.type === "Ollama" ||
                match.type === "LM Studio" ||
                match.type === "Open WebUI";
            const isDefaultEnhancement =
                isEnhancementService &&
                !hasDefaultEnhancement &&
                !provisioned.some(
                    (p) =>
                        p === "Ollama" ||
                        p === "LM Studio" ||
                        p === "Open WebUI",
                );

            await db.insert(apiCredentials).values({
                userId,
                provider: "openai",
                apiKey: encrypt("local-bypass"),
                baseUrl: match.baseUrl,
                nickname: `Local ${match.type} (Auto-detected)`,
                defaultModel: match.defaultModel,
                isDefaultTranscription,
                isDefaultEnhancement,
            });
            provisioned.push(match.type);
        }
    }

    return NextResponse.json({
        success: true,
        found,
        provisioned,
    });
});
