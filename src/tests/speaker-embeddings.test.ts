import { describe, expect, it } from "vitest";
import {
    cosineSimilarity,
    EMBEDDING_DIMENSIONS,
    isEmbedding,
    mergeCentroid,
    normalizeEmbedding,
    parseEmbedding,
    toStoredEmbedding,
} from "../lib/speakers/embeddings";

/** A deterministic unit-ish vector of the required width. */
function vector(fn: (i: number) => number): number[] {
    return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => fn(i));
}

const ONES = vector(() => 1);
const RAMP = vector((i) => i + 1);

describe("isEmbedding", () => {
    it("accepts a finite, non-zero vector of the exact width", () => {
        expect(isEmbedding(ONES)).toBe(true);
        expect(isEmbedding(RAMP)).toBe(true);
    });

    it("rejects wrong widths, non-arrays and non-numbers", () => {
        expect(isEmbedding(vector(() => 1).slice(1))).toBe(false);
        expect(isEmbedding([...ONES, 1])).toBe(false);
        expect(isEmbedding("nope")).toBe(false);
        expect(isEmbedding(null)).toBe(false);
        expect(isEmbedding(vector((i) => (i === 3 ? Number.NaN : 1)))).toBe(
            false,
        );
        expect(
            isEmbedding(
                vector((i) => (i === 3 ? Number.POSITIVE_INFINITY : 1)),
            ),
        ).toBe(false);
    });

    it("rejects a zero vector, which has no direction to match on", () => {
        expect(isEmbedding(vector(() => 0))).toBe(false);
    });
});

describe("parseEmbedding", () => {
    it("returns the vector when valid", () => {
        expect(parseEmbedding(ONES)).toEqual(ONES);
    });

    it("names the offending field in the error message", () => {
        expect(() =>
            parseEmbedding([1, 2, 3], "embeddings.SPEAKER_00"),
        ).toThrow(
            /embeddings\.SPEAKER_00 must contain exactly 256 numbers, received 3/,
        );
    });

    it("rejects non-arrays, non-finite entries and zero vectors", () => {
        expect(() => parseEmbedding("nope")).toThrow(/must be an array/);
        expect(() =>
            parseEmbedding(vector((i) => (i === 0 ? Number.NaN : 1))),
        ).toThrow(/finite numbers/);
        expect(() => parseEmbedding(vector(() => 0))).toThrow(/zero vector/);
    });
});

describe("normalizeEmbedding", () => {
    it("scales to unit length", () => {
        const unit = normalizeEmbedding(RAMP);
        const magnitude = Math.sqrt(
            unit.reduce((sum, value) => sum + value * value, 0),
        );
        expect(magnitude).toBeCloseTo(1, 10);
    });

    it("returns a zero vector unchanged rather than dividing by zero", () => {
        const zero = vector(() => 0);
        expect(normalizeEmbedding(zero)).toEqual(zero);
    });
});

describe("toStoredEmbedding", () => {
    it("is unit length and rounded to six decimals", () => {
        const stored = toStoredEmbedding(RAMP);
        const magnitude = Math.sqrt(
            stored.reduce((sum, value) => sum + value * value, 0),
        );
        expect(magnitude).toBeCloseTo(1, 5);
        for (const value of stored) {
            expect(value).toBe(Math.round(value * 1e6) / 1e6);
        }
    });

    it("round-trips through isEmbedding", () => {
        expect(isEmbedding(toStoredEmbedding(RAMP))).toBe(true);
    });
});

describe("cosineSimilarity", () => {
    it("is 1 for identical directions regardless of magnitude", () => {
        expect(cosineSimilarity(ONES, ONES)).toBeCloseTo(1, 10);
        expect(
            cosineSimilarity(
                ONES,
                ONES.map((v) => v * 17),
            ),
        ).toBeCloseTo(1, 10);
    });

    it("is -1 for opposed directions", () => {
        expect(
            cosineSimilarity(
                RAMP,
                RAMP.map((v) => -v),
            ),
        ).toBeCloseTo(-1, 10);
    });

    it("is 0 for orthogonal vectors", () => {
        const a = vector((i) => (i % 2 === 0 ? 1 : 0));
        const b = vector((i) => (i % 2 === 0 ? 0 : 1));
        expect(cosineSimilarity(a, b)).toBe(0);
    });

    it("returns 0 rather than NaN for mismatched or zero-magnitude input", () => {
        expect(cosineSimilarity(ONES, [1, 2, 3])).toBe(0);
        expect(cosineSimilarity([], [])).toBe(0);
        expect(
            cosineSimilarity(
                ONES,
                vector(() => 0),
            ),
        ).toBe(0);
    });
});

describe("mergeCentroid", () => {
    it("leaves the centroid alone when the sample matches it", () => {
        const centroid = toStoredEmbedding(RAMP);
        const merged = mergeCentroid(centroid, 4, RAMP);
        expect(cosineSimilarity(merged, centroid)).toBeCloseTo(1, 6);
    });

    it("moves toward a new sample, and less so as sampleCount grows", () => {
        const centroid = toStoredEmbedding(ONES);
        const sample = vector((i) => (i % 2 === 0 ? 1 : -1));

        const afterOne = mergeCentroid(centroid, 1, sample);
        const afterMany = mergeCentroid(centroid, 50, sample);

        // Both drift toward the sample, but the established profile drifts less.
        expect(cosineSimilarity(afterOne, sample)).toBeGreaterThan(
            cosineSimilarity(centroid, sample),
        );
        expect(cosineSimilarity(afterMany, sample)).toBeLessThan(
            cosineSimilarity(afterOne, sample),
        );
        expect(cosineSimilarity(afterMany, centroid)).toBeGreaterThan(
            cosineSimilarity(afterOne, centroid),
        );
    });

    it("ignores sample magnitude, so a loud sample cannot dominate", () => {
        const centroid = toStoredEmbedding(ONES);
        const sample = vector((i) => (i % 2 === 0 ? 1 : -1));
        const loud = sample.map((v) => v * 1000);

        const quiet = mergeCentroid(centroid, 3, sample);
        const shouted = mergeCentroid(centroid, 3, loud);
        expect(cosineSimilarity(quiet, shouted)).toBeCloseTo(1, 6);
    });

    it("treats a sampleCount below 1 as 1", () => {
        const centroid = toStoredEmbedding(ONES);
        const sample = vector((i) => (i % 2 === 0 ? 1 : -1));
        expect(mergeCentroid(centroid, 0, sample)).toEqual(
            mergeCentroid(centroid, 1, sample),
        );
    });

    it("produces a vector that is still storable", () => {
        const merged = mergeCentroid(toStoredEmbedding(ONES), 2, RAMP);
        expect(isEmbedding(merged)).toBe(true);
    });
});
