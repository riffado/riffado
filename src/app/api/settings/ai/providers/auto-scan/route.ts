import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

// Helper to fetch with a timeout
async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 800,
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

// Probe functions
async function probeFasterWhisper(
    baseUrl: string,
): Promise<{ defaultModel: string; baseUrl: string } | null> {
    try {
        const res = await fetchWithTimeout(`${baseUrl}/models`);
        if (res.ok) {
            const data = await res.json();
            const firstModel = data?.data?.[0]?.id || "faster-whisper";
            return { defaultModel: firstModel, baseUrl };
        }
    } catch {}
    return null;
}

async function probeOllama(
    url: string,
): Promise<{ defaultModel: string; baseUrl: string } | null> {
    try {
        const res = await fetchWithTimeout(`${url}/api/tags`);
        if (res.ok) {
            const data = await res.json();
            const firstModel = data?.models?.[0]?.name || "llama3";
            return { defaultModel: firstModel, baseUrl: `${url}/v1` };
        }
    } catch {}
    return null;
}

async function probeOpenWebUi(
    url: string,
): Promise<{ defaultModel: string; baseUrl: string } | null> {
    try {
        // Try config endpoint
        const res = await fetchWithTimeout(`${url}/config`);
        if (res.status === 200 || res.status === 401 || res.status === 403) {
            return { defaultModel: "gpt-4o", baseUrl: url };
        }
    } catch {}
    try {
        // Try models endpoint
        const res = await fetchWithTimeout(`${url}/models`);
        if (res.status === 200 || res.status === 401 || res.status === 403) {
            return { defaultModel: "gpt-4o", baseUrl: url };
        }
    } catch {}
    return null;
}

const WHISPER_TARGETS = [
    "http://whisper:8000/v1",
    "http://mesynx-ai-whisper:8000/v1",
    "http://host.docker.internal:8397/v1",
    "http://localhost:8397/v1",
];

const OLLAMA_TARGETS = [
    "http://host.docker.internal:11434",
    "http://ollama:11434",
    "http://localhost:11434",
];

const OPEN_WEBUI_TARGETS = [
    "http://host.docker.internal:3000/api",
    "http://host.docker.internal:8080/api",
    "http://open-webui:8080/api",
    "http://openwebui:8080/api",
    "http://localhost:3000/api",
    "http://localhost:8080/api",
];

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

    const found: string[] = [];
    const provisioned: string[] = [];

    // 1. Scan for Whisper
    let whisperMatch: { defaultModel: string; baseUrl: string } | null = null;
    for (const target of WHISPER_TARGETS) {
        const result = await probeFasterWhisper(target);
        if (result) {
            whisperMatch = result;
            break;
        }
    }

    if (whisperMatch) {
        found.push("Faster Whisper");
        const alreadyExists = existingBaseUrls.has(
            whisperMatch.baseUrl.toLowerCase().trim(),
        );
        if (!alreadyExists) {
            const hasDefaultTranscription = existingProviders.some(
                (p) => p.isDefaultTranscription,
            );
            await db.insert(apiCredentials).values({
                userId,
                provider: "openai",
                apiKey: encrypt("local-bypass"),
                baseUrl: whisperMatch.baseUrl,
                nickname: "Local Whisper (Auto-detected)",
                defaultModel: whisperMatch.defaultModel,
                isDefaultTranscription: !hasDefaultTranscription,
                isDefaultEnhancement: false,
            });
            provisioned.push("Faster Whisper");
        }
    }

    // 2. Scan for Ollama
    let ollamaMatch: { defaultModel: string; baseUrl: string } | null = null;
    for (const target of OLLAMA_TARGETS) {
        const result = await probeOllama(target);
        if (result) {
            ollamaMatch = result;
            break;
        }
    }

    if (ollamaMatch) {
        found.push("Ollama");
        const alreadyExists = existingBaseUrls.has(
            ollamaMatch.baseUrl.toLowerCase().trim(),
        );
        if (!alreadyExists) {
            const hasDefaultEnhancement = existingProviders.some(
                (p) => p.isDefaultEnhancement,
            );
            await db.insert(apiCredentials).values({
                userId,
                provider: "openai",
                apiKey: encrypt("local-bypass"),
                baseUrl: ollamaMatch.baseUrl,
                nickname: "Local Ollama (Auto-detected)",
                defaultModel: ollamaMatch.defaultModel,
                isDefaultTranscription: false,
                isDefaultEnhancement: !hasDefaultEnhancement,
            });
            provisioned.push("Ollama");
        }
    }

    // 3. Scan for Open WebUI
    let openWebUiMatch: { defaultModel: string; baseUrl: string } | null = null;
    for (const target of OPEN_WEBUI_TARGETS) {
        const result = await probeOpenWebUi(target);
        if (result) {
            openWebUiMatch = result;
            break;
        }
    }

    if (openWebUiMatch) {
        found.push("Open WebUI");
        const alreadyExists = existingBaseUrls.has(
            openWebUiMatch.baseUrl.toLowerCase().trim(),
        );
        if (!alreadyExists) {
            const hasDefaultEnhancement =
                existingProviders.some((p) => p.isDefaultEnhancement) ||
                provisioned.includes("Ollama");
            await db.insert(apiCredentials).values({
                userId,
                provider: "openai",
                apiKey: encrypt("local-bypass"),
                baseUrl: openWebUiMatch.baseUrl,
                nickname: "Local Open WebUI (Auto-detected)",
                defaultModel: openWebUiMatch.defaultModel,
                isDefaultTranscription: false,
                isDefaultEnhancement: !hasDefaultEnhancement,
            });
            provisioned.push("Open WebUI");
        }
    }

    return NextResponse.json({
        success: true,
        found,
        provisioned,
    });
});
