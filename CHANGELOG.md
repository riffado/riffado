# Changelog

## [Unreleased]

### Fixed
- Audio uploads no longer require `ffprobe`/`ffmpeg` on the host. Duration is now parsed in pure JS via [`music-metadata`](https://github.com/Borewit/music-metadata), fixing uploads on the published Docker image (which never shipped ffmpeg) and on local dev environments where `ffprobe` is missing from the Node process `PATH` ([#58](https://github.com/openplaud/openplaud/issues/58)).

### Added
- New connect screen with three methods: **Sign in with Plaud** (browser-extension bridge — the easy path), **Email code** (existing OTP flow), and **Paste token** (advanced fallback). Targets accounts created via Google or Apple sign-in on Plaud, where the OTP flow silently signs users into a separate empty shadow account and sync returns zero recordings ([#65](https://github.com/openplaud/openplaud/issues/65)).
- Companion browser extension [openplaud/connector](https://github.com/openplaud/connector) (AGPL-3.0) detected by the connect screen via `window.__openplaudConnector`. Lets users sign in to Plaud the way they normally do — Google, Apple, or email/password — with no copy-pasting. The extension hands the resulting access token back to OpenPlaud via the new `/api/plaud/auth/connect-token` endpoint, which encrypts it (AES-256-GCM) and persists alongside any existing OTP-flow connections.
- AI output language selector — choose the language for AI-generated summaries and titles, independent of the transcript's language ([#57](https://github.com/openplaud/openplaud/issues/57)).

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

[unreleased]: https://github.com/openplaud/openplaud/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/openplaud/openplaud/releases/tag/v0.1.0
