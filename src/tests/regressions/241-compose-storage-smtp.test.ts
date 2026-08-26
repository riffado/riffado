/**
 * Regression test for issue #241 (bugs 4 and 5): the published
 * docker-compose.yml dropped SMTP_* from the app environment (Compose
 * interpolates `.env` for `${VAR}` but does not inject those vars into
 * the container unless they are listed) and only volume-mounted
 * `/app/audio`. The app default `LOCAL_STORAGE_PATH` is `./storage`,
 * which is `/app/storage` in the image, so redeploy wiped audio.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");

describe("issue #241: official compose persist + SMTP passthrough", () => {
    it("forwards SMTP_* from .env into the app container", () => {
        for (const key of [
            "SMTP_HOST",
            "SMTP_PORT",
            "SMTP_SECURE",
            "SMTP_USER",
            "SMTP_PASSWORD",
            "SMTP_FROM",
            "SMTP_MARKETING_FROM",
            "SMTP_REPLY_TO",
        ]) {
            expect(compose).toContain(`${key}: \${${key}:-}`);
        }
    });

    it("persists both /app/audio and /app/storage", () => {
        expect(compose).toContain("- audio:/app/audio");
        expect(compose).toContain("- storage:/app/storage");
        expect(compose).toMatch(/^\s{2}audio:\s*$/m);
        expect(compose).toMatch(/^\s{2}storage:\s*$/m);
    });
});
