import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const { originalNextPhase } = vi.hoisted(() => {
    const original = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    return { originalNextPhase: original };
});

import { envSchema } from "@/lib/env";

afterAll(() => {
    if (originalNextPhase === undefined) {
        delete process.env.NEXT_PHASE;
    } else {
        process.env.NEXT_PHASE = originalNextPhase;
    }
});

describe("STATUS_TOKEN env", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is unset by default", () => {
        expect(envSchema.parse({}).STATUS_TOKEN).toBeUndefined();
        expect(envSchema.parse({ STATUS_TOKEN: "  " }).STATUS_TOKEN).toBe(
            undefined,
        );
    });

    it("accepts a long token and trims surrounding whitespace", () => {
        const token = "a".repeat(40);
        expect(
            envSchema.parse({ STATUS_TOKEN: ` ${token}\n` }).STATUS_TOKEN,
        ).toBe(token);
    });

    it("treats a malformed token as unset and warns without printing it", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const short = "short-secret-token";
        const spaced = `${"b".repeat(20)} ${"c".repeat(20)}`;
        expect(envSchema.parse({ STATUS_TOKEN: short }).STATUS_TOKEN).toBe(
            undefined,
        );
        expect(envSchema.parse({ STATUS_TOKEN: spaced }).STATUS_TOKEN).toBe(
            undefined,
        );
        expect(warn).toHaveBeenCalledTimes(2);
        const logged = warn.mock.calls.flat().join(" ");
        expect(logged).toContain("STATUS_TOKEN");
        expect(logged).not.toContain(short);
        expect(logged).not.toContain("b".repeat(20));
    });

    it("is passed into the app container by docker-compose.yml", () => {
        const compose = readFileSync(
            join(process.cwd(), "docker-compose.yml"),
            "utf8",
        );
        expect(compose).toContain(`STATUS_TOKEN: \${STATUS_TOKEN:-}`);
    });
});
