/**
 * Regression guard for a production crash on /admin/billing (PostHog issue
 * 019f905d-4454-7612-8681-02f489bbf1ed): every render threw a masked
 * "An error occurred in the Server Components render" digest error.
 *
 * Root cause: `billingOverview()`'s raw SQL referenced the `subscriptions`
 * table's `interval` column bare/unqualified inside `lower(interval)`.
 * `interval` is a fully reserved PostgreSQL keyword (it introduces
 * `INTERVAL '...'` literals), so Postgres's grammar only accepts it as an
 * identifier when double-quoted or dot-qualified (e.g. `s.interval`, used
 * correctly everywhere else in this file). The bare reference caused a
 * hard SQL syntax error on every single execution.
 *
 * This test statically guards the source so a future edit can't
 * reintroduce a bare, unquoted `interval` column reference in this file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin-billing.ts interval column references", () => {
    const source = readFileSync(
        join(__dirname, "..", "db", "queries", "admin-billing.ts"),
        "utf-8",
    );

    it("never references the `interval` column bare/unqualified", () => {
        // Every reference to the subscriptions.interval column must be
        // either dot-qualified (s.interval) or double-quoted ("interval").
        // A bare `interval` (no leading `.` or `"`) is a Postgres reserved
        // keyword and causes a SQL syntax error. Exclude `interval:` (a
        // TS field name) and `interval '...'` (the valid INTERVAL literal
        // syntax, e.g. `now() - interval '30 days'`).
        const bareIntervalRefs =
            source.match(/[^."]\binterval\b(?!:)(?!\s*')/g) ?? [];
        expect(bareIntervalRefs).toEqual([]);
    });
});
