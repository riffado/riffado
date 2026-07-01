/**
 * Browser-only audio decoding for in-browser Whisper transcription.
 *
 * Transformers.js's automatic-speech-recognition pipeline expects raw
 * mono PCM samples at 16 kHz (a `Float32Array`), NOT an encoded audio
 * file. Whisper itself is trained at 16 kHz. Decoding + resampling has
 * to happen on the main thread because `OfflineAudioContext` is not
 * available inside a Web Worker. We hand the resulting `Float32Array`
 * to the worker, which feeds it straight to the pipeline.
 */

const WHISPER_SAMPLE_RATE = 16000;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
    const w = window as typeof window & {
        webkitAudioContext?: AudioContextCtor;
    };
    const ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!ctor) {
        throw new Error(
            "Web Audio API is unavailable; browser transcription is not supported here.",
        );
    }
    return ctor;
}

/**
 * Decode an encoded audio blob (mp3, opus, wav, …) into mono 16 kHz PCM
 * samples suitable for the Whisper pipeline.
 */
export async function decodeAudioToMono16k(blob: Blob): Promise<Float32Array> {
    const arrayBuffer = await blob.arrayBuffer();

    const AudioCtx = getAudioContextCtor();
    const decodeCtx = new AudioCtx();
    let decoded: AudioBuffer;
    try {
        // `decodeAudioData` decodes at the file's native sample rate.
        decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
        // Free the hardware audio context promptly; we only needed it
        // to decode.
        void decodeCtx.close();
    }

    // Already mono at the target rate: downmix is a no-op, just return.
    if (
        decoded.numberOfChannels === 1 &&
        decoded.sampleRate === WHISPER_SAMPLE_RATE
    ) {
        return decoded.getChannelData(0).slice();
    }

    // Resample (and downmix) via an OfflineAudioContext rendered at the
    // Whisper sample rate. The context downmixes multi-channel input to
    // its single output channel automatically.
    const frameCount = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE || 1);
    const offline = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return rendered.getChannelData(0).slice();
}
