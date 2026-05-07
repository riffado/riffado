# Changelog

## [Unreleased]

### Added
- One-line self-host installer: `curl -fsSL https://openplaud.com/install.sh | sh`. Detects OS, verifies Docker + Compose v2, downloads `docker-compose.yml` and `env.example` from the matching GitHub release, generates `BETTER_AUTH_SECRET` / `ENCRYPTION_KEY` / `POSTGRES_PASSWORD`, starts the stack, and waits on `/api/health`. Version-pinned form available at `https://openplaud.com/vX.Y.Z/install.sh`. Source: [`scripts/install.sh`](scripts/install.sh) ([#95](https://github.com/openplaud/openplaud/issues/95)).

### Changed
- `docker-compose.yml` now reads `POSTGRES_PASSWORD` from the environment (default `postgres`, preserving existing deploys). The new installer generates a random value; existing self-host operators can rotate by setting `POSTGRES_PASSWORD` in `.env`, recreating the `db` volume, and restoring from a backup ([#95](https://github.com/openplaud/openplaud/issues/95)).

### Security
- User content is now encrypted at rest with AES-256-GCM keyed off `ENCRYPTION_KEY`. Covers `recordings.filename`, `transcriptions.text`, `ai_enhancements.{summary, key_points, action_items}`, and `user_settings.{summary_prompt, title_generation_prompt}`. Defends against database-only compromise (stolen backups, snapshot leaks, read-replica access). Does **not** make hosted operators unable to read content — the server still decrypts at request time to run transcription and summarization. Self-host with browser/local AI for true zero-knowledge. Pre-existing rows stay plaintext until rewritten or backfilled; run `bun scripts/encrypt-backfill.ts` once after upgrading to encrypt history. Full threat model in [docs/encryption-at-rest.md](docs/encryption-at-rest.md).

## [0.3.0] - 2026-05-07

### Added
- New connect screen with three methods: **Sign in with Plaud** (browser-extension bridge — the easy path), **Email code** (existing OTP flow), and **Paste token** (advanced fallback). Targets accounts created via Google or Apple sign-in on Plaud, where the OTP flow silently signs users into a separate empty shadow account and sync returns zero recordings ([#65](https://github.com/openplaud/openplaud/issues/65)).
- Companion browser extension [openplaud/connector](https://github.com/openplaud/connector) (AGPL-3.0) detected by the connect screen via `window.__openplaudConnector`. Lets users sign in to Plaud the way they normally do — Google, Apple, or email/password — with no copy-pasting. The extension hands the resulting access token back to OpenPlaud via the new `/api/plaud/auth/connect-token` endpoint, which encrypts it (AES-256-GCM) and persists alongside any existing OTP-flow connections.
- AI output language selector — choose the language for AI-generated summaries and titles, independent of the transcript's language ([#57](https://github.com/openplaud/openplaud/issues/57)).
- Forgot/reset password flow with email-delivered reset links via better-auth. Login surfaces the "Forgot password?" link only when SMTP is configured; reset revokes all other sessions to limit damage from compromised credentials ([#82](https://github.com/openplaud/openplaud/issues/82)).
- Delete recording action in the workstation UI ([#56](https://github.com/openplaud/openplaud/issues/56)).
- `IS_HOSTED` env flag — set to `true` on the OpenPlaud-operated hosted instance to render the marketing landing page at `/`. Defaults to `false` so self-host instances no longer serve OpenPlaud's hosted-tier marketing surface ([#70](https://github.com/openplaud/openplaud/issues/70)).
- `DISABLE_REGISTRATION` env flag — set to `true` to close a self-host instance to new sign-ups. Wired through better-auth's `disableSignUp`, the `/register` page, and the login footer link. Defaults to `false`, preserving current behavior ([#59](https://github.com/openplaud/openplaud/issues/59)).

### Changed
- Logged-out visitors at `/` now redirect to `/login` instead of seeing the marketing landing page. This is the new default for self-host. Operators who want to keep the marketing surface (or who want to host a fork's own landing page) can set `IS_HOSTED=true` ([#70](https://github.com/openplaud/openplaud/issues/70)).
- Audio duration is now parsed in JavaScript on upload instead of shelling out to `ffprobe`. The `ffprobe` binary is no longer required in the Docker image or on the host ([#58](https://github.com/openplaud/openplaud/issues/58)).

### Fixed
- Plaud recording endpoints now mint a workspace-scoped token, fixing 403s on EU/APAC accounts where the OTP-flow access token lacks workspace permissions ([#66](https://github.com/openplaud/openplaud/issues/66)).
- Settings now shows the instance storage type from the environment instead of a hardcoded value ([#78](https://github.com/openplaud/openplaud/pull/78) by [@sauerhosen](https://github.com/sauerhosen)).

## [0.2.0] - 2026-04-28

### Changed
- Self-host install now uses published Docker images instead of `git clone`. See [README](README.md#-quick-start) and [BRANCHING.md](BRANCHING.md). Existing `git pull && docker compose up --build` setups keep working.
- Docker tag `:latest` now tracks the newest stable release (previously tracked `main`). New `:dev` tag tracks `main` for bleeding-edge users.

### Added
- `BRANCHING.md` — branching and release model.
- `docker-compose.dev.yml` — overlay for building the image from local source.
- `OPENPLAUD_VERSION` env var for pinning the image tag.
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
- Initial release of OpenPlaud
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

[unreleased]: https://github.com/openplaud/openplaud/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/openplaud/openplaud/releases/tag/v0.3.0
[0.2.0]: https://github.com/openplaud/openplaud/releases/tag/v0.2.0
[0.1.0]: https://github.com/openplaud/openplaud/releases/tag/v0.1.0
