<div align="center">

![Riffado](.github/assets/banner.png)

**Open-source AI transcription companion for voice recorders.**

*Bring your own AI provider, own your transcripts, self-host or hosted.*

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://riffado.com/discord)

[Quick start](#quick-start) • [Documentation](https://riffado.com/docs) • [Discord](https://riffado.com/discord)

</div>

---

> **OpenPlaud is now Riffado.** Same project, same code, same team, same license &mdash; renamed in May 2026 so the project isn't tied to one device vendor in its name. [Read the rebrand note &rarr;](https://riffado.com/rebrand)

Riffado is an open-source companion app for AI voice recorders. It syncs your recordings from the manufacturer's cloud, transcribes them with any OpenAI-compatible API (or in the browser, for free), and stores everything on infrastructure you control. **Currently supports the Plaud Note family — Note, Note Pro, and NotePin. More device support on the way.** AGPL-3.0.

## Features

- Self-hosted. Your recordings, your storage, your API keys.
- Works with any OpenAI-compatible provider — OpenAI, Groq, OpenRouter, Together, LM Studio, Ollama, Azure, anything with a `baseURL`.
- Free browser transcription via Transformers.js (Whisper in WebAssembly).
- Local filesystem or S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi).
- AES-256-GCM encryption at rest for tokens, API keys, transcripts, and summaries.
- Auto-sync on a schedule, with browser and email notifications.
- Full export and backup — JSON, TXT, SRT, VTT, plus one-archive backup/restore.
- Automation API with signed webhooks for integrations.
- Zero-config Docker Compose deploy.

## Quick start

You need Docker, a Plaud account at [plaud.ai](https://plaud.ai), and (optionally) an OpenAI-compatible API key.

**One-liner (Linux / macOS):**

```bash
curl -fsSL https://riffado.com/install.sh | sh
```

Prompts for an install directory and `APP_URL`, downloads `docker-compose.yml` and `.env`, generates secrets, starts the stack, and waits for `/api/health`. Source: [`scripts/install.sh`](scripts/install.sh).

**Manual install:**

```bash
mkdir riffado && cd riffado
curl -fLO https://github.com/riffado/riffado/releases/latest/download/docker-compose.yml
curl -fL  https://github.com/riffado/riffado/releases/latest/download/env.example -o .env

# Generate secrets, paste into .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

docker compose up -d
```

Open <http://localhost:3000/register> and create your account. The onboarding wizard handles Plaud connection, AI providers, storage, and sync preferences.

**Upgrade:** `docker compose pull && docker compose up -d`. Migrations run on container start.

Full install guide, version pinning, image tags, and Windows/WSL notes: [riffado.com/docs/self-hosting/install](https://riffado.com/docs/self-hosting/install).

> `main` is a rolling integration branch. Deploy from tagged image releases, not by building `main`. See [BRANCHING.md](BRANCHING.md).

## Connecting Plaud

Riffado signs into Plaud using your email — the same OTP flow as the official app. The verification code is forwarded directly to Plaud and never stored. Your access token is encrypted with AES-256-GCM before hitting the database. Region (Global, EU, APAC) is auto-detected.

If you signed up to Plaud with **Continue with Google** or **Continue with Apple**, the email-code flow won't return any recordings — that's a different identity on Plaud's side. Use the [Riffado Connector browser extension](https://github.com/riffado/connector), or paste a token manually. Full instructions: [riffado.com/docs/guides/connect-plaud-account](https://riffado.com/docs/guides/connect-plaud-account).

> Every line that handles your credentials is open source — [send-code route](src/app/api/plaud/auth/send-code/route.ts) · [verify route](src/app/api/plaud/auth/verify/route.ts) · [encryption](src/lib/encryption.ts).

## Documentation

Everything lives at **[riffado.com/docs](https://riffado.com/docs)**. Direct links:

- [Install & first run](https://riffado.com/docs/self-hosting/install)
- [Environment variables](https://riffado.com/docs/self-hosting/environment-variables)
- [Upgrading](https://riffado.com/docs/self-hosting/upgrading)
- [S3-compatible storage](https://riffado.com/docs/self-hosting/storage-s3)
- [Email / SMTP](https://riffado.com/docs/self-hosting/email-smtp)
- [Connect your Plaud account](https://riffado.com/docs/guides/connect-plaud-account)
- [AI providers](https://riffado.com/docs/guides/ai-providers)
- [Backup & restore](https://riffado.com/docs/guides/backup-and-restore)
- [Notifications](https://riffado.com/docs/guides/notifications)
- [Automation & webhooks](https://riffado.com/docs/guides/automation-and-webhooks)
- [Public API reference](https://riffado.com/docs/reference/public-api)
- [Encryption at rest](https://riffado.com/docs/reference/encryption-at-rest)
- [Security model](https://riffado.com/docs/reference/security-model)
- [Architecture](https://riffado.com/docs/reference/architecture)

## Contributing

Bug reports, feature requests, and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the PR workflow, [BRANCHING.md](BRANCHING.md) for the release model, and [CHANGELOG.md](CHANGELOG.md) for version history.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for disclosure.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Free to use, modify, and self-host. If you run a modified version as a network service, you must publish your source.

## Disclaimer

- **Not affiliated.** Riffado is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Plaud Inc. or any of its subsidiaries. "Plaud" and related marks are the property of their respective owners and are used here only for descriptive interoperability purposes (nominative fair use).
- **Third-party devices and services.** Riffado is designed to interoperate with hardware and services from third parties that users choose to connect — including recording devices (such as Plaud) and storage and AI providers. Users are solely responsible for complying with the applicable terms of service, acceptable-use policies, and laws governing any third-party device or service they connect to this software.

## Acknowledgments

Originally created by **Perier**. Maintained by the Riffado community.
