import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import {
    discoverLocalAiServices,
    parseTailscaleHosts,
} from "@/lib/ai/local-discovery";
import { planProvisioning } from "@/lib/ai/provision-plan";
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

export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    // Never network-scan from the hosted multi-tenant app: it would probe
    // Mesynx-internal infrastructure, not the user's machine.
    if (env.IS_HOSTED) {
        return NextResponse.json({
            success: true,
            found: [],
            provisioned: [],
            manual: [],
        });
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
        existingProviders.flatMap((p) => {
            const url = p.baseUrl?.toLowerCase().trim();
            return url ? [url] : [];
        }),
    );
    const hasDefaultTranscription = existingProviders.some(
        (p) => p.isDefaultTranscription,
    );
    const hasDefaultEnhancement = existingProviders.some(
        (p) => p.isDefaultEnhancement,
    );

    // `LLM_HOSTS`, when set, is an explicit override that disables Tailscale
    // discovery. Otherwise pull online peers from Tailscale.
    const tailscaleHosts = env.LLM_HOSTS ? [] : await discoverTailscaleHosts();

    const { services } = await discoverLocalAiServices({ env, tailscaleHosts });

    // Decide what to provision, what to leave for manual setup (Open WebUI),
    // and what was found. Pure policy — see provision-plan.ts.
    const { inserts, manual, found } = planProvisioning(services, {
        existingBaseUrls,
        hasDefaultTranscription,
        hasDefaultEnhancement,
    });

    for (const item of inserts) {
        await db.insert(apiCredentials).values({
            userId,
            provider: "openai",
            apiKey: encrypt(item.apiKey),
            baseUrl: item.baseUrl,
            nickname: item.nickname,
            defaultModel: item.defaultModel,
            isDefaultTranscription: item.isDefaultTranscription,
            isDefaultEnhancement: item.isDefaultEnhancement,
        });
    }

    return NextResponse.json({
        success: true,
        found,
        // De-duplicated so the toast reads "Ollama, LM Studio", not repeats.
        provisioned: [...new Set(inserts.map((i) => i.type))],
        manual,
    });
});
