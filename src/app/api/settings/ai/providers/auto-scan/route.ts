import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import {
    type DiscoveredServiceType,
    discoverLocalAiServices,
    parseTailscaleHosts,
} from "@/lib/ai/local-discovery";
import { requireApiSession } from "@/lib/auth-server";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

const execAsync = promisify(exec);

// --- Tailscale peer discovery (subprocess + short cache) -------------------
// Cached briefly so repeated scans don't re-shell `tailscale status` every
// time (mirrors odysseus's 60s _HOSTS_CACHE_TTL). Module-level state lives for
// the server process — the single-tenant self-host context this path runs in.
let tailscaleHostsCache: string[] = [];
let tailscaleHostsCacheTime = 0;
const TAILSCALE_CACHE_TTL_MS = 60_000;

async function discoverTailscaleHosts(): Promise<string[]> {
    const now = Date.now();
    if (
        tailscaleHostsCache.length > 0 &&
        now - tailscaleHostsCacheTime < TAILSCALE_CACHE_TTL_MS
    ) {
        return [...tailscaleHostsCache];
    }

    try {
        const { stdout } = await execAsync("tailscale status --json", {
            timeout: 3000,
        });
        const hosts = parseTailscaleHosts(stdout);
        if (hosts.length > 0) {
            tailscaleHostsCache = hosts;
            tailscaleHostsCacheTime = now;
        }
        return hosts;
    } catch {
        // tailscale not installed / not running — fall back to local hosts.
        return [];
    }
}

// --- Default-role assignment for newly provisioned services ----------------
const TRANSCRIPTION_TYPES: ReadonlySet<DiscoveredServiceType> = new Set([
    "Faster Whisper",
]);
const ENHANCEMENT_TYPES: ReadonlySet<DiscoveredServiceType> = new Set([
    "Ollama",
    "LM Studio",
    "Open WebUI",
]);

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    // Never network-scan from the hosted multi-tenant app: it would probe
    // Mesynx-internal infrastructure, not the user's machine.
    if (env.IS_HOSTED) {
        return NextResponse.json({ success: true, found: [], provisioned: [] });
    }

    const userId = session.user.id;

    const existingProviders = await db
        .select({
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
    let hasDefaultTranscription = existingProviders.some(
        (p) => p.isDefaultTranscription,
    );
    let hasDefaultEnhancement = existingProviders.some(
        (p) => p.isDefaultEnhancement,
    );

    // `LLM_HOSTS`, when set, is an explicit override that disables Tailscale
    // discovery. Otherwise pull online peers from Tailscale.
    const tailscaleHosts = env.LLM_HOSTS ? [] : await discoverTailscaleHosts();

    const { services } = await discoverLocalAiServices({ env, tailscaleHosts });

    const found: DiscoveredServiceType[] = [];
    const provisioned: DiscoveredServiceType[] = [];

    for (const svc of services) {
        found.push(svc.type);

        const baseUrlKey = svc.baseUrl.toLowerCase().trim();
        if (existingBaseUrls.has(baseUrlKey)) continue;

        const isDefaultTranscription =
            TRANSCRIPTION_TYPES.has(svc.type) && !hasDefaultTranscription;
        const isDefaultEnhancement =
            ENHANCEMENT_TYPES.has(svc.type) && !hasDefaultEnhancement;
        if (isDefaultTranscription) hasDefaultTranscription = true;
        if (isDefaultEnhancement) hasDefaultEnhancement = true;

        // Faster Whisper ships with a working placeholder key the project's
        // docs tell users to use ("sk-placeholder"); lock it in so the server
        // works out of the box. Other local backends accept any key.
        const apiKey =
            svc.type === "Faster Whisper" ? "sk-placeholder" : "local-bypass";

        await db.insert(apiCredentials).values({
            userId,
            provider: "openai",
            apiKey: encrypt(apiKey),
            baseUrl: svc.baseUrl,
            nickname: `Local ${svc.type} (Auto-detected)`,
            defaultModel: svc.defaultModel || null,
            isDefaultTranscription,
            isDefaultEnhancement,
        });
        // Guard against two discovered endpoints sharing a baseUrl in one scan.
        existingBaseUrls.add(baseUrlKey);
        provisioned.push(svc.type);
    }

    // De-duplicate the type labels so the UI toast reads "Ollama, LM Studio"
    // rather than "Ollama, Ollama".
    return NextResponse.json({
        success: true,
        found: [...new Set(found)],
        provisioned: [...new Set(provisioned)],
    });
});
