import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
    {
        pattern: /crossSubDomainCookies/,
        reason: "crossSubDomainCookies scopes cookies to the parent domain, which would leak customer sessions to admin.riffado.com once ADMIN_HOSTNAME is set.",
    },
    {
        pattern: /\bdomain\s*:\s*['"`][.\w-]+['"`]/,
        reason: "A `domain:` cookie attribute scopes cookies to a parent domain. Riffado keeps cookies host-only so the customer host and admin host have isolated sessions.",
    },
];

describe("Better Auth cookie scope regression", () => {
    const authPath = join(process.cwd(), "src/lib/auth.ts");
    const source = readFileSync(authPath, "utf8");

    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        it(`src/lib/auth.ts does not match ${pattern}`, () => {
            const match = source.match(pattern);
            if (match) {
                throw new Error(
                    `Forbidden pattern ${pattern} matched in src/lib/auth.ts:\n` +
                        `  matched text: ${JSON.stringify(match[0])}\n` +
                        `  reason: ${reason}`,
                );
            }
            expect(match).toBeNull();
        });
    }
});
