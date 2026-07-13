import { afterAll, beforeAll, describe, expect, it } from "vitest";

type EnvSchema = typeof import("@/lib/env")["envSchema"];
let envSchema: EnvSchema;
let originalNextPhase: string | undefined;

beforeAll(async () => {
    originalNextPhase = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    ({ envSchema } = await import("@/lib/env"));
});

afterAll(() => {
    if (originalNextPhase === undefined) {
        delete process.env.NEXT_PHASE;
    } else {
        process.env.NEXT_PHASE = originalNextPhase;
    }
});

describe("Whisper environment configuration", () => {
    it("uses safe compression and request-timeout defaults", () => {
        const parsed = envSchema.parse({});

        expect(parsed.WHISPER_MAX_BYTES).toBe(24 * 1024 * 1024);
        expect(parsed.WHISPER_COMPRESS_BITRATE_KBPS).toBe(12);
        expect(parsed.WHISPER_REQUEST_TIMEOUT_MS).toBe(60 * 60 * 1000);
    });

    it("parses positive operator overrides", () => {
        const parsed = envSchema.parse({
            WHISPER_MAX_BYTES: "10485760",
            WHISPER_COMPRESS_BITRATE_KBPS: "16",
            WHISPER_REQUEST_TIMEOUT_MS: "1800000",
        });

        expect(parsed.WHISPER_MAX_BYTES).toBe(10 * 1024 * 1024);
        expect(parsed.WHISPER_COMPRESS_BITRATE_KBPS).toBe(16);
        expect(parsed.WHISPER_REQUEST_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });

    it.each([
        ["WHISPER_MAX_BYTES", "0"],
        ["WHISPER_COMPRESS_BITRATE_KBPS", "invalid"],
        ["WHISPER_REQUEST_TIMEOUT_MS", "-1"],
    ])("rejects invalid %s values", (field, value) => {
        expect(() => envSchema.parse({ [field]: value })).toThrow();
    });
});
