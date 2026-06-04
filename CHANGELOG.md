# Changelog

## [Unreleased]

> Mesynx AI is a distribution of [Riffado](https://github.com/riffado/riffado). The entries below are the
> changes layered on top of the upstream Riffado base.

### Added
- **Self-hosted GPU transcription.** Bundled a [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) `whisper` service in `docker-compose.yml` (NVIDIA GPU, host port `8397`) plus a standalone [`whisper-server/`](whisper-server/) compose file for running Whisper on a separate box. This closes the gap where chat-only local servers (Ollama, Open WebUI) return `405` on `/v1/audio/transcriptions` and can't transcribe at all. A persistent `whisper_cache` volume keeps downloaded models across container recreates (large-v3 is ~3 GB). [`whisper-server/README.md`](whisper-server/README.md) documents model selection and VAD-based anti-hallucination guidance for long recordings.
- **Provider nickname.** Optional user-facing label for custom / self-hosted providers (`ai_providers.nickname`), so a base URL like `http://100.x.x.x:8397/v1` can read as "Home GPU · faster-whisper" in the providers list and dialogs.
- **Searchable model picker.** After a successful **Test Connection**, Mesynx AI discovers the server's available models and offers a type-to-filter dropdown (with model count) instead of a free-text model field — no more guessing exact model IDs.

### Changed
- **Redesigned Memory Map.** The recording summary mind-map is now interactive: hover a node to trace and highlight its branch (with animated edges), click a leaf to expand its full text, and **Show full map** opens a centered, full-screen modal. The layout engine was rebuilt to eliminate the label overlap present in the previous version.
- **Rebrand: Riffado → Mesynx AI** across the app, docs, `package.json`, and brand assets. New README banner and a "What's new vs. Riffado" section documenting the differences.

### Fixed
- **AI Providers settings race condition.** The Providers section now fetches its own data on open (with a loading spinner) instead of relying on a server-rendered seed that could resolve too late. Fixes the intermittent bug where saved provider configs — or their API keys — failed to appear when opening Settings.

## [0.5.6] - 2026-05-30

## [0.5.5] - 2026-05-30

### Fixed
- Rate-limit bucket upsert crashed every `/api/v1/*` and `/api/plaud/sync` request with `postgres-js` `ERR_INVALID_ARG_TYPE` ("Received an instance of Date") under Bun / Next 16. Drizzle only runs column encoders for `.values({...})` and bare column-mapped values; `Date` values interpolated into raw `` sql`case when reset_at <= ${now}` `` templates reached the driver as raw JS objects. Cast all Date params in the bucket upsert to `${iso}::timestamp`, matching the (TZ-naive) column type. Same hardening applied to six implicit text→timestamp comparisons in admin analytics queries that could also defeat index usage on `created_at` / `last_sync` ([#193](https://github.com/mesynx-ai/mesynx-ai/pull/193)).
- Admin user search no longer treats `%` and `_` in the query as `ILIKE` wildcards. Escape with `` escape '\' `` so a search for `_admin` matches literal `_admin`, not anything ending in `admin`. Admin-only surface, low severity ([#193](https://github.com/mesynx-ai/mesynx-ai/pull/193)).

### Changed
- Rate limiter now **fails open** when the bucket store is unreachable. The previous behavior returned a 500 to every authenticated request when the DB upsert errored, taking the entire v1 API and Plaud sync down with the rate limiter. The new behavior catches the error, logs `[rate-limit] bucket store unavailable; failing open` for Sentry visibility, and lets the request through with a synthetic full bucket. A broken safety net should not collapse the building; upstream (Cloudflare / ALB) still rate-limits at the edge and `/api/v1/*` has per-token auth as a second gate. Trade-off: under a sustained outage an attacker could briefly burst past nominal limits ([#193](https://github.com/mesynx-ai/mesynx-ai/pull/193)).

## [0.5.4] - 2026-05-29

### Added
- `PLAUD_PROXY_SCOPE` env var (`all` default | `api-only`) controlling whether `resource.plaud.ai` signed-URL audio downloads go through the Webshare residential proxy. Audio bytes dominate proxy bandwidth; operators who verify `resource.plaud.ai` serves direct from their egress IPs (via `scripts/plaud-egress-probe.sh`) can flip to `api-only` and save most of the Webshare quota without affecting API correctness. Default `all` preserves existing behavior.
- `PLAUD_SYNC_RATE_LIMIT_PER_MINUTE` env var (default 10) capping per-user sync requests. Backstops the new client-side throttling at the route boundary so a script hammering `POST /api/plaud/sync` is rejected before any Plaud or Webshare call is issued.

### Changed
- `WEBSHARE_API_KEY` proxy path now uses native `fetch` through `undici.ProxyAgent` instead of the previous `wreq-js` dependency. Drops a Rust napi addon from the standalone Docker image and removes the Turbopack workaround in `next.config.ts`. No behavioral change for proxy users; direct-egress path unchanged.
- Sync flow now coalesces concurrent calls for the same user inside one Next.js worker into a single Plaud round-trip; secondary callers receive the same result with an `inProgress: true` marker and the client renders it as a quiet no-op (no extra `router.refresh()`, no duplicate toast). Combined with a new client-side cross-tab `localStorage` in-flight stamp (90s TTL) and a 5s floor on manual sync taps, this collapses N-tab fan-out and rage-clicks before they reach the API.

### Removed
- `wreq-js` dependency.

## [0.5.3] - 2026-05-15

### Fixed
- Plaud sync when `WEBSHARE_API_KEY` is set crashed the server with `Cannot find package 'wreq-js' from '.next/server/chunks/[turbopack]_runtime.js'` on Docker deploys. v0.5.2 listed `wreq-js` in `serverExternalPackages` so Turbopack would leave a runtime `externalImport`, but under Next 16 + Turbopack the standalone file tracer does not follow that dynamic import, so `node_modules/wreq-js` never landed in `.next/standalone/node_modules`. Add the package (and its prebuilt `.node` binaries) to `outputFileTracingIncludes` so it ships into the standalone output. Self-host without `WEBSHARE_API_KEY` was unaffected (the module is only required on the proxy path).

## [0.5.2] - 2026-05-15

### Fixed
- Plaud sync from hosted/VPS deploys whose ASN is flagged by Cloudflare: pair the Webshare residential proxy from v0.5.1 with a Chrome TLS/JA3 fingerprint via `wreq-js`, so Bun's default handshake stops getting a 403 + Cloudflare challenge even from a clean residential IP. Required because Cloudflare scores ASN and TLS fingerprint independently; #148 only addressed the ASN side. Direct path (no `WEBSHARE_API_KEY` set) is unchanged and does not load the new dependency at runtime ([#152](https://github.com/mesynx-ai/mesynx-ai/pull/152)).

## [0.5.1] - 2026-05-15

### Added
- Optional outbound proxy for Plaud API calls via Webshare residential proxies. When `WEBSHARE_API_KEY` is set, every request to `api*.plaud.ai` / `resource.plaud.ai` routes through a random valid proxy from the Webshare list, with automatic rotation on Cloudflare 403/407 responses. Unset (default) keeps the direct egress path. Required for hosted deployments on flagged datacenter ASNs where Cloudflare returns a 403 HTML challenge before requests reach Plaud's origin; not needed for residential / homelab self-hosts. No effect on non-Plaud outbound traffic. `scripts/plaud-egress-probe.sh` can validate proxy behavior end-to-end against a real account ([#148](https://github.com/mesynx-ai/mesynx-ai/pull/148)).

## [0.5.0] - 2026-05-15

### Added
- Automation API: versioned `/api/v1/recordings` namespace for external agents (list with cursor pagination + `created_since` / `updated_since` / `has_transcription` filters, get, transcript, metadata, audio redirect). Personal API keys (`op_...` prefix, HMAC-SHA256 hashed at rest keyed by `API_TOKEN_HASH_SECRET ?? BETTER_AUTH_SECRET`, revocable, with `source` / `name` / `lastUsedAt` metadata) managed from Settings. Per-IP and per-identity rate limits on `/api/v1/*` (1200/min IP, 600/min identity) with `Retry-After` and `X-RateLimit-*` headers. Signed webhooks (HMAC-SHA256, `t=...,v1=...` header) for `recording.synced`, `recording.updated`, `recording.deleted`, `transcription.completed`, `transcription.failed` with URL + secret encrypted at rest, exponential backoff (30s -> 6h, then dead), DB-leased worker, manual redelivery, and a deliveries inspector. Webhook target policy switches on `WEBHOOKS_REQUIRE_PUBLIC_TARGETS ?? IS_HOSTED`: self-host defaults permissive so docker-bridge URLs like `http://n8n:5678/webhook` keep working. Full reference in `docs/API.md` ([#118](https://github.com/mesynx-ai/mesynx-ai/pull/118)).
- Documentation site at `/docs` with Guides, Self Hosting, and Reference sections (fumadocs-mdx). `/llms.txt` and `/llms-full.txt` routes for LLM-friendly access ([#131](https://github.com/mesynx-ai/mesynx-ai/pull/131)).
- Dashboard waveform player: client-side AudioContext decode on first listen, peaks cached server-side in `recordings.waveform_peaks`, canvas renderer with hover timestamp and vertical playhead. Auto-decode capped at 30min with a manual "Generate waveform" button above that. New `user_settings.player_scrubber` preference (`waveform` | `slider`) with toggle in Playback settings ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Command palette (Cmd/Ctrl+K) for sync, upload, settings, theme, and recording typeahead with fuzzy search over filenames and transcript text. Inline `Transcribe` quick-action on audio-only rows; Cmd+Enter triggers transcribe on the highlighted row without closing the palette. Keyboard shortcuts cheatsheet (`?`), `j`/`k` list nav, `/` for search focus, `,` for settings ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Recording list redesign: search, sort + density toggles, date-grouped rows with sticky headers, status chips (transcript / summary / in-flight), per-row delete via hover menu, infinite-scroll sentinel replacing Prev/Next, optimistic upload and delete. New `user_settings.list_density` preference ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Settings redesign with grouped sidebar nav (Providers / Plaud / Personalize / Data / Integrations / Advanced), new primitives (`SettingsSectionHeader`, `SettingsCard`, `ToggleRow`), hash routing, and a master-detail mobile layout. New Storage section with usage hero, per-status breakdown bar, and top-5 largest-recordings list with deep links ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Running version shown in the footer as a link to its release notes. Self-host instances also see an "update available" badge when a newer GitHub release exists (cached 5 minutes, fails silently). New optional `DISABLE_UPDATE_CHECK` env var for instances that block outbound HTTPS or want zero phone-home. `/api/health` response gains an additive `version` field ([#124](https://github.com/mesynx-ai/mesynx-ai/pull/124), [#123](https://github.com/mesynx-ai/mesynx-ai/issues/123)).
- Footer "Report a bug" button and toast `[Report]` action that pre-fill a GitHub issue with an `errorId` correlation token (and an "Email us" option on hosted). Every response with HTTP status >= 500 now carries `details.errorId` (`err_xxxxxxxx`) tying the JSON envelope to a single `console.error` log line, so users can quote it and support can grep logs. Connect / verify / paste-token error sites in `plaud-connect-tabs` migrated to `toastApiError` so the Report action lights up on 5xx ([#143](https://github.com/mesynx-ai/mesynx-ai/pull/143)).
- `/install` page with copyable curl one-liner and version-pinned form, plus a "View raw script" escape hatch -- replaces the previous footer link that dumped raw shell into the browser. Reachable from the footer in both self-host and hosted ([#125](https://github.com/mesynx-ai/mesynx-ai/pull/125)).

### Changed
- API key format adopts base62 + CRC32 checksum (`op_<base62-secret><crc32>`). New keys are 1 character shorter, checksum-validated before any DB lookup, so malformed input is rejected early. Existing keys continue to work unchanged ([#139](https://github.com/mesynx-ai/mesynx-ai/pull/139)).
- Sticky page header with consolidated user menu (email-initial avatar, inline 3-button theme control, identity block, kbd hints). Status-aware sync button replaces the separate status block + button -- label cycles `Synced 2m ago` / `Sync device` / `Syncing...` / `Retry sync` with tooltip carrying next-auto-sync ETA or error message ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Shared imperative confirm dialog (`useConfirm()`) replaces ad-hoc destructive-action confirmations across recording delete, webhook delete, custom-prompt delete, and provider delete. One dialog UI for every destructive action ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- React 19 cleanup pass: `forwardRef` -> ref-as-prop, `useContext` -> `use()`, em dashes replaced with commas/colons/periods in user-facing copy, display headings tightened to `font-semibold`, hydration mismatch on locale-formatted timestamps fixed via a new `<LocalTime>` component, plus component splits (workstation, settings dialog, providers section, webhooks section, command palette, recording player, onboarding) to drop giant-component sizes. SEO metadata added for `/` and `/suspended` ([#138](https://github.com/mesynx-ai/mesynx-ai/pull/138)).
- Theme system rewritten as a thin wrapper over `next-themes` to fix Radix `useId` hydration drift on Next 16. `middleware.ts` renamed to `proxy.ts` for the Next 16 entrypoint change. Behavior unchanged ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Release pipeline hardened against tag/version drift: `scripts/release.ts` creates both the release commit and the `[Unreleased]` cycle commit, then pushes `main` and the tag atomically; the release workflow now hard-gates on `package.json` version matching the pushed tag and checks out the tagged ref ([#124](https://github.com/mesynx-ai/mesynx-ai/pull/124), [#123](https://github.com/mesynx-ai/mesynx-ai/issues/123)).
- Footer split: minimal in-app footer (logo, AGPL, version + update badge, GitHub, hosted-only Support) for signed-in screens, and a separate hosted-only `LandingFooter` (Product / Resources / Company / Legal columns + honesty rail disclaiming HIPAA / SOC 2 certification) for marketing surfaces. Self-host always sees the minimal footer ([#125](https://github.com/mesynx-ai/mesynx-ai/pull/125)).

### Fixed
- Install `git` in the Docker builder so fumadocs-mdx's `lastModified` plugin can read commit timestamps; without it the docs build fell back to mtime and emitted noisy warnings ([#140](https://github.com/mesynx-ai/mesynx-ai/pull/140)).
- Send browser `User-Agent` on all Plaud API requests. Plaud's edge started 403-ing non-browser UAs, breaking sync on certain regional servers ([#136](https://github.com/mesynx-ai/mesynx-ai/pull/136), [#132](https://github.com/mesynx-ai/mesynx-ai/issues/132)).
- Run fumadocs-mdx codegen in the Docker builder stage instead of via `postinstall`, so generated MDX bindings ship inside the runtime image and `/docs` doesn't 500 on cold containers ([#134](https://github.com/mesynx-ai/mesynx-ai/pull/134)).
- Send `chunking_strategy` for diarization-capable transcription models, and consolidate the manual-transcribe and sync-transcribe code paths so they agree on request shape. Fixes diarize-model failures on long recordings ([#128](https://github.com/mesynx-ai/mesynx-ai/pull/128), [#101](https://github.com/mesynx-ai/mesynx-ai/issues/101)).
- OpenRouter transcription now routes through chat-completions (OpenRouter does not expose `/audio/transcriptions`), and the provider preset ships a curated list of transcription-capable models so the picker doesn't surface chat-only models that would 404 at request time ([#126](https://github.com/mesynx-ai/mesynx-ai/pull/126), [#122](https://github.com/mesynx-ai/mesynx-ai/issues/122)).
- Player time label no longer resizes mid-playback. `formatTimeLike(current, reference)` pads `currentTime` to match `duration`'s segment structure (`M:SS` / `MM:SS` / `H:MM:SS`) so the clock label keeps a stable width ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- Webhook worker no longer skews due-delivery comparisons under Bun: `nowParam` is cast to `::timestamp` to match the `next_attempt_at` column type ([#121](https://github.com/mesynx-ai/mesynx-ai/pull/121)).
- DELETE recording locks the parent row with `SELECT ... FOR UPDATE` at the start of the transaction, so a concurrent transcribe or summary write can't leave orphan child rows pointing at a tombstoned recording. Sync re-checks the tombstone under `FOR UPDATE` before its update + emit, preventing delete-during-download races from resurrecting a recording ([#118](https://github.com/mesynx-ai/mesynx-ai/pull/118)).
- Plaud helpers (`plaudSendCode`, `plaudVerifyOtp`, `listPlaudWorkspaces`, `mintPlaudWorkspaceToken`) parse upstream JSON defensively via a new `safeParseJson`. Cloudflare WAF HTML challenge pages (and other non-JSON upstream bodies) previously escaped as raw `SyntaxError` and flattened to a generic `INTERNAL_ERROR (500)`; they now surface as typed `PLAUD_INVALID_TOKEN` / `PLAUD_RATE_LIMITED` / `PLAUD_UPSTREAM_ERROR` / `PLAUD_API_ERROR` with the upstream HTTP status and a 200-char body snippet in `details` ([#143](https://github.com/mesynx-ai/mesynx-ai/pull/143), [#142](https://github.com/mesynx-ai/mesynx-ai/issues/142), [#137](https://github.com/mesynx-ai/mesynx-ai/issues/137)).

## [0.4.2] - 2026-05-09

### Fixed
- `/admin/reauth` returned a permanent 404 in production Docker images even with `IS_HOSTED=true` and `ADMIN_EMAILS` configured, leaving admins unable to elevate their session. The page performed its `env.IS_HOSTED` / `env.ADMIN_EMAILS` `notFound()` checks before any dynamic API call, so `next build` (which doesn't see admin env by design) statically prerendered it as a 404 and baked that into the image. Every other admin page already declared `export const dynamic = "force-dynamic"`; reauth was the only miss. Added the directive ([#113](https://github.com/mesynx-ai/mesynx-ai/pull/113)).

## [0.4.1] - 2026-05-09

### Fixed
- Bundle `scripts/encrypt-backfill.ts` into the Docker image as `/app/encrypt-backfill.js`. v0.4.0 shipped the script in source but never copied it into the runtime image, and the runtime image has no `node_modules`, so self-host operators had no way to run the encryption-at-rest backfill from a deployed container. Run via `docker compose exec app bun encrypt-backfill.js [--dry-run]`. Docs in [docs/encryption-at-rest.md](docs/encryption-at-rest.md) updated.
- Add missing migration for the v0.4.0 admin schema. v0.4.0 added `admin_audit_log`, `admin_action_log`, `users.suspended_at`, and `users.suspended_reason` to `src/db/schema.ts` but shipped without a generated SQL migration, so `pnpm db:migrate` was a no-op and `requireAuth()` — which now reads `users.suspended_at` on every authenticated request — would have errored on `column does not exist` immediately after cutover. v0.4.1 ships the additive migration (`0018_quick_joshua_kane.sql`). **Do not deploy v0.4.0; deploy v0.4.1.**

## [0.4.0] - 2026-05-09

### Added
- Switch and disconnect Plaud account from Settings — new "Plaud Account" section shows the connected email + region, with **Switch account** (clears the connection and reopens the connect dialog) and **Disconnect** actions. Legacy connections without a stored email render as "Connected (email unknown)". Recordings are unaffected by either action ([#63](https://github.com/mesynx-ai/mesynx-ai/issues/63)).
- Hosted-only admin dashboard at `/admin` with cost-attribution views (per-user storage, server transcription minutes, Plaud sync freshness, signup timeseries, pricing-snapshot CDFs) and a small set of audited operator actions (suspend / unsuspend user, force-disconnect Plaud, soft-delete recording). Gated by `IS_HOSTED=true` + `ADMIN_EMAILS` allowlist + signed elevated-session cookie (password reprompt) + optional `ADMIN_IP_ALLOWLIST`. Self-host instances 404 every admin route. Reads logged to `admin_audit_log`; mutations logged to `admin_action_log` with required reason text. Admins never see transcript text, summary text, audio, or decrypted secrets.
- `users.suspendedAt` / `users.suspendedReason` columns supporting cooperative account suspension. Suspended users are redirected to `/suspended` on next request and skipped by the sync worker on next claim. Set/cleared exclusively by the admin suspend action; unused on self-host.
- One-line self-host installer: `curl -fsSL https://mesynx.r0073dl053r.com/install.sh | sh`. Detects OS, verifies Docker + Compose v2, downloads `docker-compose.yml` and `env.example` from the matching GitHub release, generates `BETTER_AUTH_SECRET` / `ENCRYPTION_KEY` / `POSTGRES_PASSWORD`, starts the stack, and waits on `/api/health`. Version-pinned form available at `https://mesynx.r0073dl053r.com/vX.Y.Z/install.sh`. Source: [`scripts/install.sh`](scripts/install.sh) ([#95](https://github.com/mesynx-ai/mesynx-ai/issues/95)).

### Changed
- `requireAuth()` now performs a suspension check on every authenticated server-component render, and a new `requireApiSession()` helper applies the same check (plus the unified `AppError` envelope) on all user-data API routes. Self-host fast-path: column is always null so the check is a single PK lookup with no behavioral change.
- `docker-compose.yml` now reads `POSTGRES_PASSWORD` from the environment (default `postgres`, preserving existing deploys). The new installer generates a random value; existing self-host operators can rotate by setting `POSTGRES_PASSWORD` in `.env`, recreating the `db` volume, and restoring from a backup ([#95](https://github.com/mesynx-ai/mesynx-ai/issues/95)).

### Security
- User content is now encrypted at rest with AES-256-GCM keyed off `ENCRYPTION_KEY`. Covers `recordings.filename`, `transcriptions.text`, `ai_enhancements.{summary, key_points, action_items}`, and `user_settings.{summary_prompt, title_generation_prompt}`. Defends against database-only compromise (stolen backups, snapshot leaks, read-replica access). Does **not** make hosted operators unable to read content — the server still decrypts at request time to run transcription and summarization. Self-host with browser/local AI for true zero-knowledge. Pre-existing rows stay plaintext until rewritten or backfilled; run `bun scripts/encrypt-backfill.ts` once after upgrading to encrypt history. Full threat model in [docs/encryption-at-rest.md](docs/encryption-at-rest.md).

## [0.3.0] - 2026-05-07

### Added
- New connect screen with three methods: **Sign in with Plaud** (browser-extension bridge — the easy path), **Email code** (existing OTP flow), and **Paste token** (advanced fallback). Targets accounts created via Google or Apple sign-in on Plaud, where the OTP flow silently signs users into a separate empty shadow account and sync returns zero recordings ([#65](https://github.com/mesynx-ai/mesynx-ai/issues/65)).
- Companion browser extension [mesynx-ai/connector](https://github.com/mesynx-ai/connector) (AGPL-3.0) detected by the connect screen via `window.__mesynxAiConnector`. Lets users sign in to Plaud the way they normally do — Google, Apple, or email/password — with no copy-pasting. The extension hands the resulting access token back to Mesynx AI via the new `/api/plaud/auth/connect-token` endpoint, which encrypts it (AES-256-GCM) and persists alongside any existing OTP-flow connections.
- AI output language selector — choose the language for AI-generated summaries and titles, independent of the transcript's language ([#57](https://github.com/mesynx-ai/mesynx-ai/issues/57)).
- Forgot/reset password flow with email-delivered reset links via better-auth. Login surfaces the "Forgot password?" link only when SMTP is configured; reset revokes all other sessions to limit damage from compromised credentials ([#82](https://github.com/mesynx-ai/mesynx-ai/issues/82)).
- Delete recording action in the workstation UI ([#56](https://github.com/mesynx-ai/mesynx-ai/issues/56)).
- `IS_HOSTED` env flag — set to `true` on the Mesynx AI-operated hosted instance to render the marketing landing page at `/`. Defaults to `false` so self-host instances no longer serve Mesynx AI's hosted-tier marketing surface ([#70](https://github.com/mesynx-ai/mesynx-ai/issues/70)).
- `DISABLE_REGISTRATION` env flag — set to `true` to close a self-host instance to new sign-ups. Wired through better-auth's `disableSignUp`, the `/register` page, and the login footer link. Defaults to `false`, preserving current behavior ([#59](https://github.com/mesynx-ai/mesynx-ai/issues/59)).

### Changed
- Logged-out visitors at `/` now redirect to `/login` instead of seeing the marketing landing page. This is the new default for self-host. Operators who want to keep the marketing surface (or who want to host a fork's own landing page) can set `IS_HOSTED=true` ([#70](https://github.com/mesynx-ai/mesynx-ai/issues/70)).
- Audio duration is now parsed in JavaScript on upload instead of shelling out to `ffprobe`. The `ffprobe` binary is no longer required in the Docker image or on the host ([#58](https://github.com/mesynx-ai/mesynx-ai/issues/58)).

### Fixed
- Plaud recording endpoints now mint a workspace-scoped token, fixing 403s on EU/APAC accounts where the OTP-flow access token lacks workspace permissions ([#66](https://github.com/mesynx-ai/mesynx-ai/issues/66)).
- Settings now shows the instance storage type from the environment instead of a hardcoded value ([#78](https://github.com/mesynx-ai/mesynx-ai/pull/78) by [@sauerhosen](https://github.com/sauerhosen)).

## [0.2.0] - 2026-04-28

### Changed
- Self-host install now uses published Docker images instead of `git clone`. See [README](README.md#-quick-start) and [BRANCHING.md](BRANCHING.md). Existing `git pull && docker compose up --build` setups keep working.
- Docker tag `:latest` now tracks the newest stable release (previously tracked `main`). New `:dev` tag tracks `main` for bleeding-edge users.

### Added
- `BRANCHING.md` — branching and release model.
- `docker-compose.dev.yml` — overlay for building the image from local source.
- `MESYNX_AI_VERSION` env var for pinning the image tag.
- GitHub Releases attach `docker-compose.yml` and `.env.example` as install artifacts.

### Security
- Added comprehensive error handling system with safe error messages
- Implemented path traversal protection in local storage
- Fixed environment variable client-side exposure
- Added sensitive information sanitization in error responses

### Fixed
- Fixed storage type bug (was hardcoded to "local")
- Fixed device lookup to properly scope by userId
- Fixed race condition in default provider selection with transactions
- Added audio streaming range validation (416 Range Not Satisfiable)
- Improved content-type detection for multiple audio formats

### Added
- Database unique constraint on plaudDevices (userId + serialNumber)
- Performance indexes on recordings, transcriptions, and plaudDevices tables
- Retry logic for Plaud API calls with exponential backoff
- Standardized error code system for client error handling
- Test and type-check scripts in package.json

## [0.1.0] - 2025-01-22

### Added
- Initial release of Mesynx AI
- Self-hosted alternative to Plaud's subscription service
- Support for any OpenAI-compatible API (OpenAI, Groq, Together AI, OpenRouter, LM Studio, Ollama)
- Browser-based transcription using Transformers.js (Whisper models)
- Flexible storage: Local filesystem or S3-compatible (AWS S3, R2, MinIO, etc.)
- Auto-sync with configurable intervals
- Email notifications via SMTP
- Bark notifications for iOS
- Browser notifications
- AI title generation from transcriptions
- Export recordings (JSON, TXT, SRT, VTT formats)
- Backup functionality for all user data
- Modern hardware-inspired UI with dark theme
- Docker deployment with docker-compose
- PostgreSQL database with Drizzle ORM
- Better Auth for authentication
- AES-256-GCM encryption for sensitive data
- Onboarding flow for new users
- Settings management (sync, storage, transcription, AI providers, notifications)
- Audio waveform visualization with Wavesurfer.js
- Recording playback with speed control
- Transcription management
- Device management

### Security
- Encrypted storage for API keys and Plaud bearer tokens
- Secure session management
- Environment variable validation
- Path traversal protection

[unreleased]: https://github.com/mesynx-ai/mesynx-ai/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/mesynx-ai/mesynx-ai/releases/tag/v0.4.1
[0.4.0]: https://github.com/mesynx-ai/mesynx-ai/releases/tag/v0.4.0
[0.3.0]: https://github.com/mesynx-ai/mesynx-ai/releases/tag/v0.3.0
[0.2.0]: https://github.com/mesynx-ai/mesynx-ai/releases/tag/v0.2.0
[0.1.0]: https://github.com/mesynx-ai/mesynx-ai/releases/tag/v0.1.0
