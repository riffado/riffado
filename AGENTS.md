# OpenPlaud — Agent Guidelines

## First task

If the user did not give you a concrete task, read this file + `README.md` + `BRANCHING.md`, then ask which area to work on (sync, transcription, AI, storage, UI, settings, onboarding, notifications, landing).

## The One Rule

Understand what you're changing. OpenPlaud is live and in use — people depend on it to access their recordings, transcripts, and storage. If you can't explain what your change does and how it interacts with the rest of the system, don't ship it.

Using AI to write code is fine. Submitting AI-generated code you don't understand is not.

## Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

Marketing surfaces (landing page copy, README feature sections) are exempt — they follow product design, not agent rules.

## Code Quality

- No `any` types unless absolutely necessary
- Check `node_modules` for external API type definitions instead of guessing
- **NEVER use inline imports** — no `await import("./foo")`, no `import("pkg").Type` in type positions. Always top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Refactor freely and do not preserve backward compatibility on internal code unless the user explicitly asks. Internal code APIs are not a contract; only the **deploy surface** is (see below) — that one is sacred.

## Commands

- After code changes (not docs): `pnpm format-and-lint:fix && pnpm type-check`. Fix all errors and warnings before committing.
- When running check/typecheck/test commands, capture the full output — do not pipe through `| tail`, `| head`, or otherwise truncate. Hidden errors are the whole problem these commands are supposed to surface.
- Tests: `pnpm test` (from repo root). Integration tests are opt-in via `PLAUD_BEARER_TOKEN=... bun test src/tests/plaud.integration.test.ts`.
- If you create or modify a test file, run it and iterate until it passes.
- Regression tests for a specific bug go at `src/tests/regressions/<issue-number>-<short-slug>.test.ts` (create the directory the first time).
- **NEVER run without user instruction:** `pnpm dev`, `pnpm build`, `pnpm db:migrate`, `pnpm db:generate`, `docker compose up`, any release command.
- Dev diagnostics endpoint: `/api/dev/plaud/info` (dev-only, hidden in production) — probes the stored Plaud connection and reports device + recording counts. Useful for "is the connection actually working" without digging into the DB.

## **CRITICAL** Tool Usage Rules **CRITICAL**

- NEVER use `sed`/`cat` to read a file or a range of a file. Always use the Read tool (use offset + limit for ranged reads).
- You MUST read every file you modify in full before editing.

## **CRITICAL** Git Rules **CRITICAL**

Multiple agents may work on the same worktree simultaneously (subagents, parallel sessions). These rules prevent destroying other agents' work and prevent destructive mistakes even in single-agent use.

### Committing

- **ONLY commit files YOU changed in THIS session.**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR.
- NEVER use `git add -A` or `git add .` — these sweep up changes from other agents.
- ALWAYS use `git add <specific-file-paths>` listing only files you modified.
- Before committing, run `git status` and verify you are only staging YOUR files.
- Track which files you created/modified/deleted during the session.
- It is always fine to include matching `src/db/migrations/*.sql` and `src/db/migrations/meta/*` files alongside the `src/db/schema.ts` change that produced them — they are generated artifacts of your edit, not other agents' work.
- NEVER commit unless the user asks.

### Forbidden Git Operations

These can destroy work:

- `git reset --hard` — destroys uncommitted changes
- `git checkout .` — destroys uncommitted changes
- `git clean -fd` — deletes untracked files
- `git stash` — stashes ALL changes including other agents' work
- `git add -A` / `git add .` — stages other agents' uncommitted work
- `git commit --no-verify` — bypasses required checks, never allowed
- `git push --force` / `--force-with-lease` — never allowed

### Safe Workflow

```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add src/lib/storage/s3-storage.ts
git add CHANGELOG.md

# 3. Commit
git commit -m "fix(storage): correct S3 content-type fallback"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### Commit prefixes

`feat:`, `fix:`, `refactor:`, `chore:`, `perf:`, `docs:` (Conventional-Commits-ish). Squash-merge scoped features into `main`. Regular-merge long-lived branches where per-commit history matters.

### Branch model

`main` is a **rolling integration branch** — may be broken at any commit. Stable deploys come from tagged releases. See [BRANCHING.md](BRANCHING.md).

### PR workflow

- Analyze PRs without pulling locally first.
- If the user approves: create a feature branch, pull the PR, rebase on `main`, apply adjustments, commit, merge into `main`, push, close the PR, and leave a comment in the user's tone.
- You never open PRs yourself. Work in feature branches until everything matches the user's requirements, then merge into `main` and push.

### Rebase conflicts

- Resolve conflicts in YOUR files only.
- If conflict is in a file you didn't modify, abort and ask the user.
- NEVER force-push.

### User override

If user instructions conflict with these rules, ask for explicit confirmation before executing. Only then override.

## GitHub Issues and PRs

### Reading

- Always read all comments, not just the body.
- Recipe: `gh issue view <number> --json title,body,comments,labels,state`

### Creating issues

Three templates — pick the right one:

- `bug_report.yml` — user-facing bug
- `feature_request.yml` — user-facing feature suggestion
- `task.yml` — internal agent-handoff work item

Task template has three blocks: **Context** (why + current state), **Acceptance Criteria** (concrete verifiable outcomes), **Relevant files** (optional pointers).

Title prefixes match commit prefixes. Labels: `bug`, `enhancement`, `task`, `triage`, `good first issue`, `documentation`, `help wanted`. Don't invent ad-hoc labels.

### Commenting

- Write multi-line comments to a temp file, use `gh issue comment --body-file` / `gh pr comment --body-file`. Never `--body` in shell for multi-line markdown.
- Preview the exact comment text before posting.
- Post exactly one final comment unless the user asks for more.
- If a comment is malformed, delete it and repost one corrected version.
- Tone: concise, technical, in the user's voice.

### Closing via commit

Include `closes #<n>` or `fixes #<n>` in the commit message — GitHub auto-closes when merged to `main`.

### TODOs

Plans and TODOs that need to survive a session belong in GitHub Issues, not in code comments or `plans/*.md`.

## Changelog

`CHANGELOG.md` is **maintainer-curated at release time.** Contributors do not edit it in PRs.

### Format

Entries go under `## [Unreleased]`. Subsections:

- `### Breaking Changes` — needs a migration note
- `### Added` — new features
- `### Changed` — changes to existing functionality
- `### Fixed` — bug fixes
- `### Removed` — removed features
- `### Security` — security-relevant changes

### Rules

- Before adding entries, read the full `[Unreleased]` section to see which subsections exist.
- New entries ALWAYS go under `## [Unreleased]`.
- Append to existing subsections; do not create duplicates.
- NEVER modify already-released version sections (`## [0.1.0]`, etc.) — each is immutable once released.

### Attribution format

- Internal changes: `Fixed sync stall on 429 ([#123](https://github.com/openplaud/openplaud/issues/123))`
- External contributions: `Added Groq provider ([#456](https://github.com/openplaud/openplaud/pull/456) by [@username](https://github.com/username))`

## Releasing

Agents do not cut releases — that's a maintainer action. The procedure (tag, push, workflows, draft review) lives in [BRANCHING.md](BRANCHING.md).

## Don't break existing deployments

OpenPlaud ships in **two production modes from the same codebase**:

1. **Self-host** (`IS_HOSTED` unset/false) — AGPL, `docker compose up`, single-tenant in practice, owned by the user.
2. **Hosted** (`IS_HOSTED=true`) — multi-tenant SaaS we operate. Live, paying users, profit-bearing.

Both surfaces are user contracts. The **deploy surface** — DB schema, env vars, `docker-compose.yml` structure, install flow — is a contract for self-host. The **hosted surface** — the external API at `/api/v1/*` (introduced by issue #79 / PR #80; not yet on `main`), webhook payloads, token format, and API behavior under load — will be a contract for hosted customers once those surfaces land. Internal code is not a contract for either.

- **Schema changes are additive by default.** Dropping columns or tables requires a user-impact assessment and a migration plan. See the **Database Migrations** block below.
- **Env var renames need deprecation.** Keep the old name working for at least one release cycle, log a deprecation warning, document both in `CHANGELOG.md`.
- **`docker-compose.yml` is a user contract.** Breaking structural changes need a CHANGELOG migration note.
- **The one-line installer is part of the deploy surface.** `scripts/install.sh`, the `openplaud.com/install.sh` route, and the version-pinned `openplaud.com/vX.Y.Z/install.sh` route are a single contract — the script is served from the repo file via `src/app/install.sh/route.ts` and `src/app/[version]/install.sh/route.ts`. Breaking changes (renaming, removing prompts, changing the URL shape) need a deprecation cycle and a CHANGELOG note. Self-hosters paste these URLs into their own runbooks; don't break them silently.
- **Test sync against a real Plaud account** before shipping anything touching `src/lib/sync/` or `src/lib/plaud/`. Sync regressions destroy user trust fastest.
- **Breaking changes ship with loud logging + Sentry context + CHANGELOG notes.** Never silently.
- **Never gate features behind `IS_HOSTED` in a way that breaks self-host.** Hosted-only branches must degrade cleanly to the self-host path, not crash or silently disable functionality self-hosters expect.

Ask: *"If this goes wrong, how many users notice, and how fast can they recover?"* — and answer it for **both** modes.

## Product context

OpenPlaud is AGPL-3.0, targets anyone who owns a Plaud device (Note, Note Pro, NotePin) and doesn't want Plaud's AI subscription.

### Audience slices

- **Slice 1 — Cost-conscious Plaud users** (default path; hero, The Math, Reddit quotes target these). Driver: "Plaud charges $X/mo, we charge $0." Don't care where code runs.
- **Slice 2 — Privacy / compliance professionals** (`for-professionals.tsx`): lawyers, journalists, consultants, researchers. Driver: sovereignty. Default to self-host + local AI (Whisper / Ollama). Care about auditability (AGPL) and infrastructure control.

### Delivery tiers

- **Self-host (Free, forever)** — AGPL source, `docker compose up`. Shipped. Default for Slice 2. `IS_HOSTED` unset or false.
- **Hosted (we operate it)** — same codebase, `IS_HOSTED=true`. **Live, multi-tenant, profit-bearing.** Multiple Next.js processes behind a load balancer, shared Postgres, real users paying real money. This is not aspirational. Treat it as production.

`IS_HOSTED` is the deployment-mode switch. Today it gates the marketing landing page (`src/app/page.tsx` redirects to `/login` when unset) and is the default for hosted-strict safety knobs (see Hosted mode invariants below). It is **not** the signup switch — sign-up is gated by `DISABLE_REGISTRATION` (wired into `src/lib/auth.ts` via `disableSignUp`). Other hosted-only concerns (plan-aware UI, billing, etc.) are not implemented yet; when added, prefer dedicated env knobs that default off `IS_HOSTED` rather than overloading `IS_HOSTED` itself. Code that needs to branch on mode reads `env.IS_HOSTED`; never sniff `process.env` directly. Default behavior must always be the self-host path — `IS_HOSTED=true` is opt-in to the stricter/marketing-enabled mode.

### Core invariants

- **Self-host is first-class.** If it won't run in `docker compose up`, it doesn't ship. Slice 2 literally cannot use it otherwise.
- **Local-AI path must keep working.** Transformers.js (browser) and Ollama/LM Studio (local server) are the privacy-critical path. Don't regress them for "better" cloud-provider features.
- **No vendor lock-in inside OpenPlaud either.** Storage pluggable (local / S3-compatible). AI providers pluggable (any OpenAI-compatible). Don't hardcode to one; don't add a "default cloud" fallback that silently leaks data.
- **Export parity is non-negotiable.** Full backup (one-archive export → restore elsewhere) is the proof users can leave. Every recording, transcript, summary must round-trip. Do not ship features that can't be backed up.
- **Never claim compliance we don't own.** HIPAA, SOC2, attorney-client privilege — the claim belongs to the user's AI provider + their self-host setup, not to OpenPlaud. Marketing and product copy both stay honest here.

### Hosted mode invariants (`IS_HOSTED=true`)

When designing or reviewing any feature, assume hosted is real and check both modes:

- **Multi-process safe.** No in-memory locks as the only correctness mechanism. Background workers must claim work at the DB level (`SELECT … FOR UPDATE SKIP LOCKED`) or be moved to a dedicated process. In-memory `running` flags are advisory only.
- **Multi-tenant safe.** Every query touches `userId` (see the User-Scoped Queries CRITICAL block). One user's data, quota, retries, or failures must not affect another user's experience.
- **Egress is hostile territory.** Outbound HTTP from hosted infra (webhooks, AI proxying, etc.) must default to public destinations only and DNS-pin to resolved IPs. Self-host needs the opposite default (homelab `http://n8n:5678/...` over the docker bridge must work). Branch the default on `IS_HOSTED`, not on hardcoded policy.
- **Secrets at rest.** Hosted DB exfil is a multi-user incident. Hash high-entropy secrets (API tokens) with HMAC keyed off `BETTER_AUTH_SECRET` (or a dedicated `API_TOKEN_HASH_SECRET` if introduced for rotation independence) — not plain SHA-256. Never reuse `ENCRYPTION_KEY` for HMAC; that key is reserved for AES-GCM at-rest encryption via `src/lib/encryption.ts`. Encrypt non-hashable secrets (Plaud bearer tokens, AI keys, SMTP creds, S3 creds) via `src/lib/encryption.ts`.
- **Per-user fairness.** Background queues (webhook delivery, transcription, sync) must not let one slow/abusive user starve others. Per-user concurrency caps or fair-share claim queries.
- **Rate limiting on `/api/v1/*`.** Per-token + per-IP. Required before hosted exposes a new write endpoint or a new external surface.
- **No claims of compliance we don't own.** Hosted does not make us HIPAA/SOC2 compliant. Don't ship copy that says it does.

### Marketing-vs-product gap

OpenPlaud has "marketing ahead of code" in some places. **Always cross-check landing / pricing / changelog claims against actual code before designing features that depend on them.** Known gaps:

- Plaud refresh-token handling was removed in `bed9cd3` — Plaud issues only long-lived access tokens (~300 day JWT). Do not re-add refresh-token plumbing.
- "Switch Plaud account" flow referenced on the landing page is not wired up yet.

### Target UX comparisons

- **Yes:** Plaud's own web app (the thing we're replacing), Linear, Vercel dashboards.
- **No:** generic self-host transcription stacks (Whisper + a script). OpenPlaud must feel like a product, not a pile of utilities.

## Product principles

In priority order when in doubt:

1. **Performance above all else.** Optimistic updates on writes. Data-loader patterns + link prewarm on hover. No JS or data waterfalls. Minimize blocking onboarding states.
2. **Good defaults.** Less config is best. Sensible sync intervals, retention, storage paths. Auto-detect Plaud region via `-302` redirect. Default to browser transcription when no AI provider configured.
3. **Convenience.** Shareable URLs share-ready by default. Homepage → latest recording ≤ 4 clicks. Re-auth flows are modals, not full onboarding resets.
4. **Security.** AES-256-GCM for all stored tokens. `userId` check on every user-scoped query (see CRITICAL block below). Be thoughtful about "public" endpoints. Path-traversal protection in local storage, range-header validation on audio streaming.

## Code Conventions

- Prefer **server components**; use `"use client"` only for interactivity.
- Route handlers live under `src/app/api/` — one `route.ts` per endpoint.
- Database access via Drizzle. Queries may live inline in route handlers for now (no enforced `queries/` layer yet).
- Environment variables are validated via Zod in `src/lib/env.ts`. Add new vars there and access via the validated `env` object. **Never `process.env.X` directly in feature code.**
- Toasts via `sonner`; no `alert()` or custom toast systems.
- Client components that fetch from our own API use existing `/api/...` routes — no duplicate client-side Plaud API calls.

## **CRITICAL** User-Scoped Queries **CRITICAL**

Every query that touches user-scoped data **MUST** include `where(eq(table.userId, session.user.id))`. Trusting route params or body fields without this check is a security bug — an attacker can read/modify other users' recordings, transcriptions, tokens, and AI keys.

This is not optional, not "I'll add it later," not "it's an internal endpoint." Every query. Every time.

## **CRITICAL** Encryption At Rest **CRITICAL**

These values go through `src/lib/encryption.ts` (AES-256-GCM) before hitting the DB:

- Plaud bearer tokens (`plaudConnections.bearerToken`)
- AI API keys (`apiCredentials.apiKey`)
- SMTP credentials
- S3 credentials

Decrypt only at the moment of HTTP request construction. Never log decrypted values. Never return them in API responses.

## **CRITICAL** Database Migrations **CRITICAL**

Always edit `src/db/schema.ts` first, then run `pnpm db:generate` to produce the migration. **NEVER hand-write migration SQL files.** Drizzle tracks migrations via snapshot files in `src/db/migrations/meta/` — hand-written files don't generate snapshots, which causes future `db:generate` runs to re-emit already-applied columns. That's silent history corruption.

If drizzle-kit generates SQL that re-adds columns that already exist, meta snapshots are out of sync with reality. **Fix the drift, don't hand-edit around it.** Migrations `0010-0012` are historical examples of this drift; `0013+` are clean.

## Architecture Notes

- **Sync is pull-based.** Plaud has no push. The sync worker (`src/lib/sync/sync-recordings.ts`) is idempotent and paginated.
- **Transcription runs in two places:** (1) in-browser via Transformers.js for zero-cost, or (2) server-side via any OpenAI-compatible provider. Per-recording choice, changeable from the workstation.
- **Storage is pluggable** behind `StorageProvider` (`src/lib/storage/types.ts`). Factory pattern in `factory.ts`. Don't branch on storage type in feature code.
- **AI is pluggable** via OpenAI-compatible HTTP (`src/lib/ai/`). Users configure `baseURL` + API key per provider; any OpenAI-compatible endpoint works. Don't hardcode OpenAI-specific behavior.

## Plaud API Gotchas

Non-obvious facts about Plaud's server:

- **No refresh tokens.** The OTP login flow returns only `access_token` — a long-lived JWT (~300 day expiry observed). Do not re-add refresh-token plumbing. When access tokens expire, users re-auth via the reconnect UI.
- **Regional servers.** `api.plaud.ai` is global; accounts may live on `api-euc1.plaud.ai` (EU) or `api-apse1.plaud.ai` (APAC). `/auth/otp-send-code` returns `status: -302` with `data.domains.api` when the account is on a different region. `plaudSendCode` handles the redirect.
- **Rate limiting.** `PlaudClient` has built-in retry-with-backoff on 429 + 5xx (`src/lib/plaud/client.ts`). Respect `Retry-After`.
- **Bearer tokens are encrypted at rest** in `plaudConnections.bearerToken` — see Encryption block above. Decrypt only when constructing the HTTP request.

## Extension Points

### Adding a storage adapter

Storage is configured at the **instance level** (env vars), not per-user.

1. Implement `StorageProvider` (`src/lib/storage/types.ts`): `uploadFile`, `downloadFile`, `getSignedUrl`, `deleteFile`, `testConnection`.
2. Add your adapter class in `src/lib/storage/<name>.ts`.
3. Add the new type to the `StorageType` union in `types.ts`.
4. Add a branch in `createStorageProvider()` in `src/lib/storage/factory.ts`.
5. Add any new env vars to `src/lib/env.ts` (Zod schema) and `.env.example`.
6. Validate required env vars in the factory and throw a helpful error if missing (see S3 branch for pattern).
7. Add a settings UI section if the adapter has per-user-visible config (S3 does; Local doesn't).

Don't branch on storage type anywhere outside `factory.ts`.

### Adding an AI provider

OpenPlaud doesn't have a per-provider abstraction — it uses the OpenAI SDK with a custom `baseURL`. "Adding a provider" is usually configuration, not code:

1. If the provider is OpenAI-compatible (OpenAI, Groq, Together, OpenRouter, LM Studio, Ollama, Azure, …): no code change. Users add it via the settings UI — `baseURL` + API key + model names. Document it in `README.md` under the AI Provider Setup section.
2. If the provider has non-standard auth (e.g., AWS Bedrock with SigV4): write an adapter that fronts the provider behind an OpenAI-compatible surface. Do not branch on provider name in feature code. Keep the abstraction clean.

Adding a new **AI feature** (summary style, title strategy, etc.) is different — that's new code under `src/lib/ai/` following the `generate-title.ts` / prompt-presets pattern.

### Adding a notification backend

Notifications currently have no shared interface — `src/lib/notifications/{bark,browser,email}.ts` are separate files, each invoked directly by callers. If you add a new backend:

1. Write `src/lib/notifications/<name>.ts` exporting a `send<Name>Notification()` function.
2. Wire it into callers (check how `bark.ts` and `email.ts` are called for the pattern).
3. Add env vars to `src/lib/env.ts` and `.env.example`.
4. Add a settings UI toggle if the backend is user-configurable.
5. Include a timeout (see `bark.ts` for the 3-second pattern) — notifications must never block the sync loop.

Consider introducing a shared `NotificationProvider` interface if you're adding the third or fourth backend. For now, the flat file-per-backend structure is fine.

## Pointers

- [README.md](README.md) — product overview + self-host install
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow
- [BRANCHING.md](BRANCHING.md) — branching and release model
- [CHANGELOG.md](CHANGELOG.md) — version history
- [SECURITY.md](SECURITY.md) — vulnerability disclosure
