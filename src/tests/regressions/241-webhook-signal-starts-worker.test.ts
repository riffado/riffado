/**
 * Regression test for issue #241 (bug 2): webhook deliveries sat
 * `pending` with 0 attempts, including after Redeliver. Redeliver and
 * emit both call `signalWebhookWorker()`, which previously returned
 * immediately when `started` was false.
 *
 * That happens when `register()` in instrumentation never ran in this
 * module graph (standalone scan miss, #181) or the route handler got a
 * different worker singleton than the boot hook. Kick the worker on
 * first signal so an explicit Redeliver cannot no-op.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("issue #241: webhook signal starts an unstarted worker", () => {
    it("signalWebhookWorker calls startWebhookWorker when !started", () => {
        const source = readFileSync(
            join(process.cwd(), "src/lib/webhooks/worker.ts"),
            "utf8",
        );
        const signal = source.match(
            /export function signalWebhookWorker\(\): void \{[\s\S]*?\n\}/,
        );
        expect(signal?.[0]).toContain("if (!started)");
        expect(signal?.[0]).toContain("startWebhookWorker()");
    });
});
