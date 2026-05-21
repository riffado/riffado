export const DEFAULT_BUCKETS = 500;
export const AUTO_DECODE_MAX_MS = 30 * 60 * 1000;

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (sharedCtx) return sharedCtx;
    const Ctx: typeof AudioContext | undefined =
        typeof AudioContext !== "undefined"
            ? AudioContext
            : ((window as unknown as Record<string, unknown>)
                  .webkitAudioContext as typeof AudioContext | undefined);
    if (!Ctx) {
        throw new Error("Web Audio API not available");
    }
    sharedCtx = new Ctx();
    return sharedCtx;
}

export interface PeaksResult {
    peaks: number[];
    sampleCount: number;
    durationSeconds: number;
}

/** Decode audio and return envelope peaks normalised to `[0, 1]`. */
export async function decodePeaks(
    arrayBuffer: ArrayBuffer,
    buckets: number = DEFAULT_BUCKETS,
): Promise<PeaksResult> {
    if (buckets < 32 || buckets > 2048) {
        throw new Error("buckets must be between 32 and 2048");
    }

    const ctx = getAudioContext();
    const audio = await ctx.decodeAudioData(arrayBuffer);

    const channelCount = audio.numberOfChannels;
    const length = audio.length;

    const peaks = new Float32Array(buckets);
    const samplesPerBucket = Math.max(1, Math.floor(length / buckets));

    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
        channels.push(audio.getChannelData(c));
    }

    for (let b = 0; b < buckets; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(start + samplesPerBucket, length);
        let peak = 0;
        for (let i = start; i < end; i++) {
            let sum = 0;
            for (let c = 0; c < channelCount; c++) {
                sum += channels[c][i];
            }
            const v = Math.abs(sum / channelCount);
            if (v > peak) peak = v;
        }
        peaks[b] = peak;
    }

    let maxPeak = 0;
    for (let i = 0; i < buckets; i++) {
        if (peaks[i] > maxPeak) maxPeak = peaks[i];
    }

    const out = new Array<number>(buckets);
    if (maxPeak > 0) {
        const inv = 1 / maxPeak;
        for (let i = 0; i < buckets; i++) {
            out[i] = peaks[i] * inv;
        }
    } else {
        for (let i = 0; i < buckets; i++) {
            out[i] = 0;
        }
    }

    return {
        peaks: out,
        sampleCount: length,
        durationSeconds: audio.duration,
    };
}
