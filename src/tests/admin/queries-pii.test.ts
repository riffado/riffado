import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static PII guard. The admin queries file is not allowed to reference any
 * column name that contains user-content (transcript text, summary text,
 * filenames, decrypted secrets). If you need one of these, that's a code
 * review that requires explicit sign-off; this test will fail loudly until
 * it gets one.
 *
 * This is a regex over source text -- weak by itself, but combined with the
 * "queries return derived shapes only" convention it raises the bar enough
 * that an accidental .text or .filename leak shows up here.
 */
describe("admin queries PII guard", () => {
    const raw = readFileSync(
        join(process.cwd(), "src/db/queries/admin.ts"),
        "utf8",
    );
    // Strip block comments and line comments so the file-level docstring
    // listing forbidden columns (and other JSDoc) does not trigger the
    // grep. We're scanning real code references, not prose.
    const file = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const FORBIDDEN_TOKENS = [
        // Drizzle column references we never want in admin queries.
        "transcriptions.text",
        "aiEnhancements.summary",
        "aiEnhancements.actionItems",
        "aiEnhancements.keyPoints",
        "plaudConnections.bearerToken",
        "apiCredentials.apiKey",
        "recordings.filename",
        // Raw SQL aliases for those columns (in case someone bypasses drizzle).
        "bearer_token",
        "api_key",
    ];

    for (const tok of FORBIDDEN_TOKENS) {
        it(`does not reference ${tok}`, () => {
            expect(
                file.includes(tok),
                `src/db/queries/admin.ts references ${tok}; admin must not surface this column`,
            ).toBe(false);
        });
    }
});
