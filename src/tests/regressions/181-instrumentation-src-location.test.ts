/**
 * Regression test for #181: the webhook delivery worker never started in
 * the `output: "standalone"` Docker build. Deliveries piled up in
 * `webhook_deliveries` as `pending` with 0 attempts because nothing ever
 * called `startWebhookWorker()`.
 *
 * Root cause: with a `src/` directory layout, Next.js derives the
 * instrumentation-hook scan root from the app directory's parent (`src/`,
 * not the repo root) and scans it non-recursively. A root-level
 * `instrumentation.ts` sits one level above that scan root, so Next never
 * detects it, never builds an instrumentation entry, and the standalone
 * output ships without it. `register()` was therefore never invoked.
 *
 * Fix: move the file to `src/instrumentation.ts` so it sits at the
 * convention level Next actually scans.
 *
 * The failure mode is silent -- `next build` still succeeds, the app still
 * boots, and only the background worker goes missing. This test pins the
 * file location so a move back to the repo root is caught here instead of
 * in production.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("instrumentation hook lives where Next scans it", () => {
    it("exists at src/instrumentation.ts", () => {
        expect(
            existsSync(join(ROOT, "src", "instrumentation.ts")),
            "src/instrumentation.ts is missing. Without it Next builds no " +
                "instrumentation entry and the webhook worker never starts " +
                "in the standalone build (see #181).",
        ).toBe(true);
    });

    it("is not at the repo root, where a src/ layout makes Next ignore it", () => {
        expect(
            existsSync(join(ROOT, "instrumentation.ts")),
            "instrumentation.ts at the repo root is silently dropped from " +
                "the build when a src/ directory is used. Move it to " +
                "src/instrumentation.ts (see #181).",
        ).toBe(false);
    });

    it("starts the webhook worker", () => {
        const source = readFileSync(
            join(ROOT, "src", "instrumentation.ts"),
            "utf8",
        );
        expect(source).toContain("startWebhookWorker");
        expect(source).toContain("webhooks/worker");
    });
});
