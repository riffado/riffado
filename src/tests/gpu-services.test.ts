import { describe, expect, it } from "vitest";
import {
    buildWhisperCudaSpec,
    buildWhisperxSpec,
    WHISPER_CUDA_IMAGE,
    WHISPERX_IMAGE,
} from "@/lib/docker/gpu-services";

describe("buildWhisperxSpec", () => {
    const spec = buildWhisperxSpec({ network: "mesynx_net" });

    it("uses the whisperx image and 8398:8000 binding", () => {
        expect(spec.Image).toBe(WHISPERX_IMAGE);
        expect(spec.HostConfig.PortBindings).toEqual({
            "8000/tcp": [{ HostPort: "8398" }],
        });
    });

    it("requests all nvidia GPUs", () => {
        expect(spec.HostConfig.DeviceRequests).toEqual([
            { Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] },
        ]);
    });

    it("attaches to the given network with a whisperx alias", () => {
        expect(spec.HostConfig.NetworkMode).toBe("mesynx_net");
        expect(
            spec.NetworkingConfig.EndpointsConfig.mesynx_net.Aliases,
        ).toEqual(["whisperx"]);
    });

    it("threads tokens/model overrides into Env", () => {
        const custom = buildWhisperxSpec({
            network: "n",
            hfToken: "hf_x",
            model: "large-v3",
            apiKey: "sk-real",
            batchSize: "8",
        });
        expect(custom.Env).toContain("HF_TOKEN=hf_x");
        expect(custom.Env).toContain("TRANSCRIBE_MODEL=large-v3");
        expect(custom.Env).toContain("API_KEY=sk-real");
        expect(custom.Env).toContain("BATCH_SIZE=8");
    });
});

describe("buildWhisperCudaSpec", () => {
    const spec = buildWhisperCudaSpec({ network: "n" });

    it("uses the CUDA whisper image and 8397:8000 binding", () => {
        expect(spec.Image).toBe(WHISPER_CUDA_IMAGE);
        expect(spec.HostConfig.PortBindings).toEqual({
            "8000/tcp": [{ HostPort: "8397" }],
        });
    });

    it("keeps the VAD + upload-cap env and requests GPUs", () => {
        expect(spec.Env).toContain("WHISPER__VAD_ENABLED=true");
        expect(spec.Env).toContain("WHISPER__MAX_AUDIO_FILE_SIZE_MB=500");
        expect(spec.HostConfig.DeviceRequests[0].Driver).toBe("nvidia");
    });

    it("reuses an overridden cache volume", () => {
        const spec2 = buildWhisperCudaSpec({
            network: "n",
            cacheVolume: "existing_vol",
        });
        expect(spec2.HostConfig.Binds).toEqual([
            "existing_vol:/root/.cache/huggingface",
        ]);
    });
});
