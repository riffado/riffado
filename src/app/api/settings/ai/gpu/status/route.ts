import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { WHISPER_PORT, WHISPERX_PORT } from "@/lib/ai/local-discovery";
import { requireApiSession } from "@/lib/auth-server";
import { hasNvidiaRuntime, inspectContainer, ping } from "@/lib/docker/engine";
import {
    WHISPER_CONTAINER,
    WHISPERX_CONTAINER,
} from "@/lib/docker/gpu-services";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Does a credential's base URL point at the local whisper / whisperx server? */
function baseUrlTargetsWhisper(baseUrl: string | null): boolean {
    if (!baseUrl) return false;
    try {
        const u = new URL(baseUrl);
        const port = u.port ? Number(u.port) : Number.NaN;
        if (port === WHISPER_PORT || port === WHISPERX_PORT) return true;
        return u.hostname.toLowerCase().includes("whisper");
    } catch {
        return baseUrl.toLowerCase().includes("whisper");
    }
}

interface GpuStatus {
    provisioningEnabled: boolean;
    dockerReachable: boolean;
    gpuAvailable: boolean;
    whisper: { exists: boolean; running: boolean; isCuda: boolean };
    whisperx: { exists: boolean; running: boolean };
    hasWhisperProvider: boolean;
}

/**
 * Reports whether in-UI GPU provisioning is available and the current state of
 * the whisper / whisperx containers. Drives the GPU acceleration card's
 * visibility and toggle state. Read-only; safe to call without the socket
 * (returns provisioningEnabled:false when the feature is off).
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const creds = await db
        .select({ baseUrl: apiCredentials.baseUrl })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, session.user.id));
    const hasWhisperProvider = creds.some((c) =>
        baseUrlTargetsWhisper(c.baseUrl),
    );

    const provisioningEnabled =
        !env.IS_HOSTED && env.GPU_PROVISIONING_ENABLED === true;

    const inert: GpuStatus = {
        provisioningEnabled,
        dockerReachable: false,
        gpuAvailable: false,
        whisper: { exists: false, running: false, isCuda: false },
        whisperx: { exists: false, running: false },
        hasWhisperProvider,
    };

    if (!provisioningEnabled) {
        return NextResponse.json(inert);
    }

    const dockerReachable = await ping();
    if (!dockerReachable) {
        return NextResponse.json({ ...inert, dockerReachable: false });
    }

    const [gpuAvailable, whisper, whisperx] = await Promise.all([
        hasNvidiaRuntime(),
        inspectContainer(WHISPER_CONTAINER),
        inspectContainer(WHISPERX_CONTAINER),
    ]);

    const status: GpuStatus = {
        provisioningEnabled: true,
        dockerReachable: true,
        gpuAvailable,
        whisper: {
            exists: whisper.exists,
            running: whisper.running,
            isCuda: (whisper.image ?? "").toLowerCase().includes("cuda"),
        },
        whisperx: { exists: whisperx.exists, running: whisperx.running },
        hasWhisperProvider,
    };
    return NextResponse.json(status);
});
