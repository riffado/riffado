# OpenPlaud CLI

Lightweight command-line interface for syncing and transcribing recordings from [Plaud Note](https://plaud.ai) devices. Reuses the Plaud API client from the main OpenPlaud project — no database, no web server, just a single binary.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- A Plaud account with a bearer token (see [Getting Your Token](#getting-your-plaud-bearer-token))
- An OpenAI-compatible API key for transcription (OpenAI, Groq, etc.)

## Quick Start

```bash
# From the repository root
cd cli
bun install

# Set up credentials
bun src/index.ts auth \
  --token "eyJhbGciOi..." \
  --server eu \
  --whisper-key "sk-..." \
  --whisper-model whisper-1

# List your recordings
bun src/index.ts recordings

# Transcribe a specific recording
bun src/index.ts transcribe <recording-id>

# Sync all new recordings (download + transcribe)
bun src/index.ts sync --output-dir ./plaud-recordings
```

## Commands

### `openplaud auth`

Configure credentials. Validates the bearer token against the Plaud API before saving.

```bash
# Full setup
openplaud auth \
  --token "eyJhbGciOi..." \
  --server eu \
  --whisper-key "sk-..." \
  --whisper-model whisper-1

# Update just the Whisper provider (e.g. switch to Groq)
openplaud auth \
  --whisper-key "gsk_..." \
  --whisper-url "https://api.groq.com/openai/v1" \
  --whisper-model whisper-large-v3

# Show current config (redacted)
openplaud auth --show
```

**API Servers:**
- `global` — api.plaud.ai (default for most accounts)
- `eu` — api-euc1.plaud.ai (European accounts, Frankfurt)
- `apse1` — api-apse1.plaud.ai (Asia Pacific, Singapore)
- Or pass a custom `https://*.plaud.ai` URL

### `openplaud devices`

List Plaud devices connected to your account.

```bash
openplaud devices          # Human-readable
openplaud devices --json   # Machine-readable
```

### `openplaud recordings`

List recordings from your Plaud account.

```bash
openplaud recordings                     # Last 20 recordings
openplaud recordings -n 50               # Last 50
openplaud recordings --since 2h          # Recorded in the last 2 hours
openplaud recordings --since 7d          # Last 7 days
openplaud recordings --since 2025-01-01  # Since a specific date
openplaud recordings --json              # JSON output
openplaud recordings --ids-only          # Just IDs (for scripting)
```

### `openplaud download`

Download a recording's audio file.

```bash
openplaud download <id>                   # Downloads to ./<id>.mp3
openplaud download <id> -o braindump.mp3  # Custom output path
openplaud download <id> --opus            # OPUS format (smaller)
```

### `openplaud transcribe`

Download and transcribe a single recording. Audio is downloaded, sent to the configured Whisper API, and the transcription is printed to stdout.

```bash
openplaud transcribe <id>                # Print transcription to stdout
openplaud transcribe <id> -o notes.txt   # Save to file
openplaud transcribe <id> --json         # JSON with metadata
openplaud transcribe <id> -l de          # Hint: German language
```

### `openplaud sync`

Sync new recordings since the last sync. Downloads audio, transcribes, saves both to disk, and tracks state so the next sync only fetches what's new.

```bash
openplaud sync                               # Sync since last run
openplaud sync --since 7d                    # Sync last 7 days
openplaud sync --output-dir ./recordings     # Save to specific directory
openplaud sync --no-transcribe               # Download only, skip Whisper
openplaud sync --dry-run                     # Preview what would be synced
openplaud sync --json                        # JSON output for scripting
openplaud sync -l de                         # Language hint for all transcriptions
```

### `openplaud dictionary`

Manage a dictionary of domain-specific terms and correction rules that improve transcription accuracy. Terms are passed to the Whisper `prompt` parameter to bias recognition. Correction rules are also applied as post-processing find-and-replace on the output.

```bash
openplaud dictionary              # Show all terms and corrections
openplaud dictionary show         # Same as above
openplaud dictionary edit         # Open in $EDITOR
openplaud dictionary path         # Print the file path
openplaud dictionary add TiVA     # Add a term
openplaud dictionary add "Plot → Plaud"  # Add a correction rule
```

The dictionary file lives at `~/.config/openplaud-cli/dictionary.txt`. Format:

```
# Terms — bias Whisper toward recognizing these words
TiVA
Preclinics
Smartkomm

# Corrections — also replace in output if Whisper still gets it wrong
Plot → Plaud
Diva → TiVA
Smart-Com → Smartkomm
```

The dictionary is loaded automatically on every transcription — no flags needed.

## Configuration

Credentials are stored in `~/.config/openplaud-cli/config.json` with `0600` permissions (owner-only read/write). Sync state is tracked in `~/.config/openplaud-cli/state.json`. The dictionary is at `~/.config/openplaud-cli/dictionary.txt`.

### Getting Your Plaud Bearer Token

1. Go to [plaud.ai](https://plaud.ai) and log in
2. Open DevTools (`F12`) → **Network** tab
3. Refresh the page
4. Find any request to `api.plaud.ai` (or `api-euc1.plaud.ai` for EU)
5. Copy the `Authorization` header value (the part after `Bearer `)
6. Note which API server hostname you see — use the matching `--server` flag

### Whisper Providers

The CLI works with any OpenAI-compatible Whisper API:

| Provider | Base URL | Model | Cost |
|----------|----------|-------|------|
| OpenAI | *(default)* | `whisper-1` | $0.006/min |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3` | Free |
| Together AI | `https://api.together.xyz/v1` | `whisper-large-v3` | Varies |

## Scripting Examples

```bash
# Transcribe the latest recording and copy to clipboard
openplaud recordings --ids-only -n 1 | xargs openplaud transcribe | pbcopy

# Sync and pipe each transcription somewhere
openplaud sync --json | jq -r '.[] | select(.transcription) | .transcription'

# Daily cron: sync new recordings to a directory
0 */2 * * * cd /path/to/openplaud/cli && bun src/index.ts sync -o ~/plaud-sync -l de
```

## Development

```bash
cd cli
bun install
bun src/index.ts --help
```

The CLI imports the Plaud API client from `../src/lib/plaud/` — the same code that powers the OpenPlaud web app. No duplication.
