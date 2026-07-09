/**
 * Browser-only audio decoding for in-browser Whisper transcription.
 *
 * Transformers.js's automatic-speech-recognition pipeline expects raw
 * mono PCM samples at 16 kHz (a `Float32Array`), not an encoded audio
 * file. Whisper itself is trained at 16 kHz. Decoding and resampling
 * happen on the main thread because `OfflineAudioContext` is not
 * available inside a Web Worker.
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

export async function decodeAudioToMono16k(blob: Blob): Promise<Float32Array> {
    const arrayBuffer = await blob.arrayBuffer();

    const AudioCtx = getAudioContextCtor();
    const decodeCtx = new AudioCtx();
    let decoded: AudioBuffer;
    try {
        decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
        void decodeCtx.close();
    }

    if (
        decoded.numberOfChannels === 1 &&
        decoded.sampleRate === WHISPER_SAMPLE_RATE
    ) {
        return decoded.getChannelData(0).slice();
    }

    const frameCount = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE || 1);
    const offline = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return rendered.getChannelData(0).slice();
}
