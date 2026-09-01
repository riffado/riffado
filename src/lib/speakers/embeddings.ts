/**
 * Speaker-embedding maths for voice-based speaker identification.
 *
 * Embeddings are produced outside Riffado (one fixed-width float vector
 * per diarized speaker per recording) and POSTed in. Everything here is
 * pure and transport-agnostic: validation helpers throw plain `Error`s
 * and the route handlers map them onto HTTP status codes.
 */

/** Fixed embedding width. Vectors of any other length are rejected. */
export const EMBEDDING_DIMENSIONS = 256;

/** Minimum cosine similarity for an auto-match to be written. */
export const SPEAKER_MATCH_THRESHOLD = 0.75;

/** Decimal places kept when persisting a vector. */
const STORED_DECIMALS = 6;

function magnitude(vector: number[]): number {
    let sum = 0;
    for (const value of vector) sum += value * value;
    return Math.sqrt(sum);
}

/** True when `value` is a usable embedding, without throwing. */
export function isEmbedding(value: unknown): value is number[] {
    if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) {
        return false;
    }
    for (const entry of value) {
        if (typeof entry !== "number" || !Number.isFinite(entry)) return false;
    }
    return magnitude(value as number[]) > 0;
}

/**
 * Validate an untrusted embedding from a request body.
 *
 * @throws Error with a client-safe message when the value is not a
 * finite, non-zero vector of exactly `EMBEDDING_DIMENSIONS` numbers.
 */
export function parseEmbedding(value: unknown, field = "embedding"): number[] {
    if (!Array.isArray(value)) {
        throw new Error(
            `${field} must be an array of ${EMBEDDING_DIMENSIONS} numbers`,
        );
    }
    if (value.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
            `${field} must contain exactly ${EMBEDDING_DIMENSIONS} numbers, received ${value.length}`,
        );
    }
    const parsed: number[] = [];
    for (const entry of value) {
        if (typeof entry !== "number" || !Number.isFinite(entry)) {
            throw new Error(`${field} must contain only finite numbers`);
        }
        parsed.push(entry);
    }
    if (magnitude(parsed) === 0) {
        throw new Error(`${field} must not be a zero vector`);
    }
    return parsed;
}

/** Scale a vector to unit length. Zero vectors are returned unchanged. */
export function normalizeEmbedding(vector: number[]): number[] {
    const length = magnitude(vector);
    if (length === 0) return [...vector];
    return vector.map((value) => value / length);
}

/** Round to the persisted precision so stored vectors stay compact. */
export function roundEmbedding(vector: number[]): number[] {
    const factor = 10 ** STORED_DECIMALS;
    return vector.map((value) => Math.round(value * factor) / factor);
}

/** Unit-length, rounded form of a vector, ready to store. */
export function toStoredEmbedding(vector: number[]): number[] {
    return roundEmbedding(normalizeEmbedding(vector));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for mismatched lengths or a
 * zero-magnitude operand so a corrupt row can never win a match.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Fold one new sample into a profile centroid.
 *
 * Both operands are unit-normalized first, so the centroid is a mean of
 * directions rather than of magnitudes: an unusually loud sample cannot
 * dominate the profile. `sampleCount` is the number of samples already
 * folded in, so an established profile moves less per new sample.
 */
export function mergeCentroid(
    centroid: number[],
    sampleCount: number,
    sample: number[],
): number[] {
    const weight = Math.max(1, Math.floor(sampleCount));
    const current = normalizeEmbedding(centroid);
    const incoming = normalizeEmbedding(sample);
    const merged = current.map(
        (value, i) => (value * weight + incoming[i]) / (weight + 1),
    );
    return toStoredEmbedding(merged);
}
