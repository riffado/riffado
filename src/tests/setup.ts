/**
 * Vitest setup — runs once per worker before any test module loads.
 *
 * Why this exists: `@/lib/env` validates `DATABASE_URL`, `BETTER_AUTH_SECRET`,
 * `APP_URL`, and `ENCRYPTION_KEY` at module-init time when
 * `NEXT_PHASE !== "phase-production-build"`. Any test that touches a code
 * path which transitively imports `@/lib/env` (rate limit, transcription
 * pipeline, sync, webhooks, etc.) would throw before the test body runs
 * unless it manually `vi.mock("@/lib/env")`s.
 *
 * We seed the minimum set of values required to pass validation. Tests
 * that need a specific env shape can still `vi.mock("@/lib/env")` at the
 * top of their file — those mocks win because they hoist above this
 * file's plain `process.env` assignment.
 */

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??=
    "test-better-auth-secret-with-at-least-32-chars-padding-ok";
process.env.APP_URL ??= "http://localhost:3000";
process.env.ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000000";
