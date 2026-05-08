# Encryption at rest

OpenPlaud encrypts user content fields in the database with AES-256-GCM, keyed off the `ENCRYPTION_KEY` environment variable that the runtime already requires.

This is **server-held-key envelope encryption.** It is not zero-knowledge.

## What is encrypted

| Column | Type | Notes |
|---|---|---|
| `recordings.filename` | text | Often carries topic info (e.g. AI-generated titles) |
| `transcriptions.text` | text | Full transcript |
| `ai_enhancements.summary` | text | LLM summary |
| `ai_enhancements.key_points` | jsonb | Stored as `{ "c": "v1:..." }` envelope |
| `ai_enhancements.action_items` | jsonb | Same envelope shape |
| `user_settings.summary_prompt` | jsonb | Custom prompt configs may carry user context |
| `user_settings.title_generation_prompt` | jsonb | Same |

Pre-existing encryption (unchanged):

- `plaud_connections.bearer_token`
- `api_credentials.api_key`
- `storage_config.s3_config`

Out of scope for this layer:

- **Audio files in storage** (local FS / S3). Object-level encryption is a separate, heavier change. For S3, prefer server-side encryption at the bucket level today; revisit per-object app-layer encryption later.
- **Search.** No full-text search on transcripts is implemented today, so encrypting `text` causes no regression. If search lands later, it will need a tokenized HMAC index — not this PR.

## What this protects against

- Stolen DB backups or snapshots
- Read-replica access without app-server access
- A SQL-injection that reads but does not execute application code
- Operators with DB-only access (e.g. via an admin console) cannot read content without also having the app-server key

## What this does not protect against

- A compromised application server. The server holds the key and decrypts content at request time so it can run AI on it. This is unavoidable while server-side transcription and summarization are part of the product.
- A compromised `ENCRYPTION_KEY`. Treat the key like a database master credential.
- A compromised AI provider. Plaintext is sent to whichever transcription / enhancement provider the user configured. That trust boundary is the user's choice and is independent of this layer.

If you require true zero-knowledge — where even OpenPlaud's hosted operators cannot read your data — **self-host with browser-based transcription** (Transformers.js) and a local LLM (Ollama / LM Studio). Hosted cannot give you that and we will not claim it does.

## Key management

`ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Losing the key makes encrypted content unrecoverable. Backup the key separately from the database.

Backup files produced by `/api/backup` are **plaintext** by design — they are the user's own export. Store them with the same care you'd give the unencrypted database.

## Versioning and key rotation

New ciphertext written by this layer is prefixed with `v1:`. Older formats are still readable:

- `v1:iv:tag:hex` — current. Identifies the key/version that produced it.
- `iv:tag:hex` (no prefix) — pre-existing format used for Plaud bearer tokens and AI keys. Read path tolerates it.
- Anything else — treated as legacy plaintext and returned verbatim. This is the deploy → backfill compatibility window.

Key rotation is not implemented yet. The `v1:` prefix exists so a future rotation pass can identify which rows need re-encrypting.

## Backfill

Pre-rollout rows stay plaintext until rewritten. The read path tolerates both shapes during this window. To eagerly encrypt existing rows:

```bash
# Report what would change (no writes)
bun scripts/encrypt-backfill.ts --dry-run

# Apply
bun scripts/encrypt-backfill.ts
```

The script is idempotent (skips rows already in `v1:` form), batched, and safe to interrupt and resume. It walks: `recordings.filename`, `transcriptions.text`, `ai_enhancements.{summary,key_points,action_items}`, `user_settings.{summary_prompt,title_generation_prompt}`.

## Self-host upgrade note

After upgrading to the version that introduces this layer, run `bun scripts/encrypt-backfill.ts` once to encrypt rows written before the upgrade. New rows are encrypted automatically. Skipping the backfill is safe — pre-upgrade rows just remain plaintext.

## Implementation pointers

- `src/lib/encryption.ts` — primitive AES-256-GCM helpers (unchanged).
- `src/lib/encryption/fields.ts` — content-field wrappers (`encryptText`, `decryptText`, `encryptJsonField`, `decryptJsonField`) with versioning + legacy-plaintext compatibility.
- `src/tests/encryption-fields.test.ts` — round-trip, legacy passthrough, tampering, predicates.
- `scripts/encrypt-backfill.ts` — one-shot opt-in eager backfill.
