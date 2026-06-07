import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth-server";
import {
    createContainer,
    type ProgressSnapshot,
    ping,
    pullImage,
    removeContainer,
    resolveNetworkName,
    startContainer,
    stopContainer,
} from "@/lib/docker/engine";
import {
    buildWhisperCudaSpec,
    buildWhisperxSpec,
    WHISPER_CONTAINER,
    WHISPER_CUDA_IMAGE,
    WHISPERX_CONTAINER,
    WHISPERX_IMAGE,
} from "@/lib/docker/gpu-services";
import { env } from "@/lib/env";
import { apiHandler } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProvisionEvent =
    | {
          type: "phase";
          phase: "pull" | "starting";
          service: string;
          image?: string;
      }
    | ({
          type: "pull";
          service: string;
          image: string;
          status: string;
      } & ProgressSnapshot)
    | { type: "done"; service: string }
    | { type: "complete" }
    | { type: "error"; message: string };

type Emit = (event: ProvisionEvent) => void;

/**
 * Container names the app might be reachable under, used to discover the compose
 * network so newly created GPU containers join the same network as the app.
 */
function networkCandidates(): string[] {
    return [
        process.env.HOSTNAME ?? "",
        "mesynx",
        WHISPER_CONTAINER,
        "mesynx-ai",
        "mesynx-ai-whisper",
    ].filter(Boolean);
}

async function provisionWhisperx(network: string, emit: Emit): Promise<void> {
    emit({
        type: "phase",
        phase: "pull",
        service: "whisperx",
        image: WHISPERX_IMAGE,
    });
    await pullImage(WHISPERX_IMAGE, (snap) =>
        emit({
            type: "pull",
            service: "whisperx",
            image: WHISPERX_IMAGE,
            ...snap,
        }),
    );

    emit({ type: "phase", phase: "starting", service: "whisperx" });
    // Remove any prior container of the same name so we always start from the
    // latest spec (idempotent: 404 is ignored).
    await removeContainer(WHISPERX_CONTAINER);
    const spec = buildWhisperxSpec({
        network,
        hfToken: process.env.HF_TOKEN,
        apiKey: process.env.WHISPERX_API_KEY,
        model: process.env.WHISPERX_MODEL,
        batchSize: process.env.WHISPERX_BATCH_SIZE,
    });
    const id = await createContainer(WHISPERX_CONTAINER, spec);
    await startContainer(id);
    emit({ type: "done", service: "whisperx" });
}

async function provisionWhisperCuda(
    network: string,
    emit: Emit,
): Promise<void> {
    emit({
        type: "phase",
        phase: "pull",
        service: "whisper",
        image: WHISPER_CUDA_IMAGE,
    });
    await pullImage(WHISPER_CUDA_IMAGE, (snap) =>
        emit({
            type: "pull",
            service: "whisper",
            image: WHISPER_CUDA_IMAGE,
            ...snap,
        }),
    );

    emit({ type: "phase", phase: "starting", service: "whisper" });
    // Destructive recreate of the existing CPU whisper container -> brief
    // transcription downtime (the UI confirms before calling this).
    await stopContainer(WHISPER_CONTAINER);
    await removeContainer(WHISPER_CONTAINER);
    const spec = buildWhisperCudaSpec({ network });
    const id = await createContainer(WHISPER_CONTAINER, spec);
    await startContainer(id);
    emit({ type: "done", service: "whisper" });
}

/**
 * Pull + start the requested GPU services, streaming NDJSON progress events.
 * Gated: self-host only, GPU_PROVISIONING_ENABLED, authenticated, socket
 * reachable. Errors during provisioning are streamed as `{type:"error"}` rather
 * than thrown so the client sees partial progress.
 */
export const POST = apiHandler(async (request: Request) => {
    await requireApiSession(request);

    if (env.IS_HOSTED || env.GPU_PROVISIONING_ENABLED !== true) {
        return NextResponse.json(
            { error: "GPU provisioning is not enabled on this instance." },
            { status: 404 },
        );
    }
    if (!(await ping())) {
        return NextResponse.json(
            {
                error: "Docker socket is not reachable. Apply the provisioning override and restart.",
            },
            { status: 503 },
        );
    }

    const body = (await request.json().catch(() => ({}))) as {
        diarization?: unknown;
        gpuTranscription?: unknown;
    };
    const diarization = body.diarization === true;
    const gpuTranscription = body.gpuTranscription === true;
    if (!diarization && !gpuTranscription) {
        return NextResponse.json(
            { error: "Select at least one GPU service to enable." },
            { status: 400 },
        );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let closed = false;
            const emit: Emit = (event) => {
                if (closed) return;
                controller.enqueue(
                    encoder.encode(`${JSON.stringify(event)}\n`),
                );
            };
            try {
                const network = await resolveNetworkName(networkCandidates());
                if (!network) {
                    emit({
                        type: "error",
                        message:
                            "Could not determine the Docker network for the stack.",
                    });
                    return;
                }
                if (diarization) await provisionWhisperx(network, emit);
                if (gpuTranscription) await provisionWhisperCuda(network, emit);
                emit({ type: "complete" });
            } catch (error) {
                emit({
                    type: "error",
                    message:
                        error instanceof Error
                            ? error.message
                            : "GPU provisioning failed.",
                });
            } finally {
                closed = true;
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store, no-transform",
            // Disable proxy buffering so progress streams in real time.
            "X-Accel-Buffering": "no",
        },
    });
});
