/**
 * Docker Engine `ContainerCreate` specs for the GPU services that in-UI
 * provisioning starts: whisperx (diarization) and the CUDA build of whisper
 * (GPU transcription).
 *
 * These MIRROR the compose definitions and must be kept in sync with them:
 *   - whisperx: base `whisperx` service in docker-compose.yml / deploy/docker-compose.yml
 *   - CUDA whisper: the `whisper` override in docker-compose.gpu.yml
 *
 * Pure (no I/O) so the shapes are unit-testable. The route supplies the target
 * network (resolved at runtime) and any tokens/overrides.
 */

import { WHISPER_PORT, WHISPERX_PORT } from "@/lib/ai/local-discovery";

export const WHISPERX_IMAGE = "ghcr.io/etalab-ia/whisperx-openai-api:latest";
export const WHISPER_CUDA_IMAGE = "fedirz/faster-whisper-server:latest-cuda";

/** Container names — match `container_name:` in the compose files. */
export const WHISPERX_CONTAINER = "mesynx-whisperx";
export const WHISPER_CONTAINER = "mesynx-whisper";

/** Named volumes for model caches (persist across recreates). */
const WHISPERX_CACHE_VOLUME = "mesynx-whisperx-models";
const WHISPER_CACHE_VOLUME = "mesynx-whisper-cache";

/** `--gpus all` equivalent: nvidia driver, all devices, gpu capability. */
function gpuDeviceRequests() {
    return [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }];
}

/**
 * Engine ContainerCreate body. Loosely typed (the API accepts many optional
 * fields); we only set what we need.
 */
export interface ContainerCreateSpec {
    Image: string;
    Env: string[];
    ExposedPorts: Record<string, Record<string, never>>;
    HostConfig: {
        PortBindings: Record<string, { HostPort: string }[]>;
        Binds: string[];
        RestartPolicy: { Name: string };
        DeviceRequests: ReturnType<typeof gpuDeviceRequests>;
        NetworkMode: string;
    };
    NetworkingConfig: {
        EndpointsConfig: Record<string, { Aliases: string[] }>;
    };
}

export interface WhisperxSpecOptions {
    /** Network to attach to (resolved from the running stack). */
    network: string;
    image?: string;
    apiKey?: string;
    hfToken?: string;
    model?: string;
    batchSize?: string;
    /** Override the model-cache volume (e.g. to reuse an existing one). */
    cacheVolume?: string;
}

export interface WhisperCudaSpecOptions {
    network: string;
    image?: string;
    /** Override the cache volume (the route reuses the CPU container's if found). */
    cacheVolume?: string;
}

export function buildWhisperxSpec(
    opts: WhisperxSpecOptions,
): ContainerCreateSpec {
    return {
        Image: opts.image ?? WHISPERX_IMAGE,
        Env: [
            `API_KEY=${opts.apiKey ?? "sk-placeholder"}`,
            `HF_TOKEN=${opts.hfToken ?? ""}`,
            `TRANSCRIBE_MODEL=${opts.model ?? "large-v3-turbo"}`,
            `BATCH_SIZE=${opts.batchSize ?? "16"}`,
        ],
        ExposedPorts: { "8000/tcp": {} },
        HostConfig: {
            PortBindings: {
                "8000/tcp": [{ HostPort: String(WHISPERX_PORT) }],
            },
            Binds: [
                `${opts.cacheVolume ?? WHISPERX_CACHE_VOLUME}:/data/models`,
            ],
            RestartPolicy: { Name: "unless-stopped" },
            DeviceRequests: gpuDeviceRequests(),
            NetworkMode: opts.network,
        },
        // Alias "whisperx" so discovery (which scans that hostname) resolves it,
        // matching the compose service name.
        NetworkingConfig: {
            EndpointsConfig: { [opts.network]: { Aliases: ["whisperx"] } },
        },
    };
}

export function buildWhisperCudaSpec(
    opts: WhisperCudaSpecOptions,
): ContainerCreateSpec {
    return {
        Image: opts.image ?? WHISPER_CUDA_IMAGE,
        Env: [
            "WHISPER__VAD_ENABLED=true",
            "WHISPER__MAX_AUDIO_FILE_SIZE_MB=500",
        ],
        ExposedPorts: { "8000/tcp": {} },
        HostConfig: {
            PortBindings: {
                "8000/tcp": [{ HostPort: String(WHISPER_PORT) }],
            },
            Binds: [
                `${opts.cacheVolume ?? WHISPER_CACHE_VOLUME}:/root/.cache/huggingface`,
            ],
            RestartPolicy: { Name: "unless-stopped" },
            DeviceRequests: gpuDeviceRequests(),
            NetworkMode: opts.network,
        },
        NetworkingConfig: {
            EndpointsConfig: { [opts.network]: { Aliases: ["whisper"] } },
        },
    };
}
