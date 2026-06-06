# Self-hosted GPU transcription (Whisper + WhisperX)

Two transcription servers you can run on any NVIDIA GPU box, both exposing the **OpenAI-compatible** `/v1/audio/transcriptions` endpoint that Mesynx AI uses.

| Service | Port | Best for |
| --- | --- | --- |
| **faster-whisper-server** | 8397 | Standard transcription — fast, accurate, VAD-enabled |
| **WhisperX** | 8398 | Word-aligned timestamps + **speaker diarization** (who said what) |

> **Why this exists.** Chat-only local servers like Ollama and Open WebUI don't implement the audio endpoint — they return `405 Method Not Allowed` on `/v1/audio/transcriptions`. Both servers here slot in cleanly as Mesynx AI providers. The same services ship in the main [`docker-compose.yml`](../docker-compose.yml); use this standalone file if you'd rather run transcription on a separate GPU box from the app.

---

## Requirements

- An NVIDIA GPU + recent drivers
- Docker + the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- (WhisperX only) A free Hugging Face account with the pyannote licence accepted — see [WhisperX setup](#setup-hugging-face-token--pyannote-licence) below

---

## Quick start

```bash
cd whisper-server

# Copy and fill in the two required secrets (API key + HF token for diarization)
cp ../.env.example .env

# Start both servers
docker compose up -d

# Verify they are online
curl http://localhost:8397/v1/models   # faster-whisper
curl http://localhost:8398/v1/models   # WhisperX
```

On WSL or a flaky network, pull images on the GPU host directly:

```bash
docker pull fedirz/faster-whisper-server:latest-cuda
docker pull ghcr.io/etalab-ia/whisperx-openai-api:latest
```

Models are downloaded on first use and cached in named Docker volumes — they survive restarts.

---

## faster-whisper-server (port 8397)

Standard Whisper transcription with VAD (Voice Activity Detection) enabled by default — the single biggest fix for hallucinations on long recordings.

### Connecting faster-whisper-server to Mesynx AI

1. **Settings → AI Providers → Add Provider**
2. **Provider:** `Custom (OpenAI-compatible)`
3. **Nickname:** `Home GPU · faster-whisper`
4. **Base URL:**
   - `http://whisper:8000/v1` — same Compose network
   - `http://<gpu-host>:8397/v1` — remote machine / Tailscale
5. **Test Connection** → pick a model → **Use for transcription** → save

### Choosing a model

| Model | Best for |
| --- | --- |
| `Systran/faster-whisper-large-v3` | Highest accuracy |
| `deepdml/faster-whisper-large-v3-turbo-ct2` | **Long recordings (recommended default)** — near v3 quality, much faster, fewer repeat-loops |
| `Systran/faster-whisper-medium` | Lower VRAM GPUs |
| `distil-whisper/distil-large-v3` | English long-form; very stable |

If you've been seeing hallucinations with `large-v3`, switching to **`deepdml/faster-whisper-large-v3-turbo-ct2`** is the highest-impact single change.

### VAD (anti-hallucination)

VAD is enabled by default (`WHISPER__VAD_ENABLED=true`). It strips non-speech segments before they ever reach the model, preventing Whisper from "inventing" text during silences. Turn it off only if you find it's aggressively trimming real speech:

```yaml
environment:
  WHISPER__VAD_ENABLED: "false"
```

---

## WhisperX speaker diarization (port 8398)

WhisperX adds two things on top of standard Whisper:

1. **Forced alignment** — word-level timestamps refined with a separate alignment model, much more precise than Whisper's built-in timestamps
2. **Speaker diarization** — identifies who is speaking when, labelling each segment with `SPEAKER_00:`, `SPEAKER_01:`, etc.

Mesynx AI automatically renders diarized transcripts as **colour-coded speaker blocks** — no manual formatting needed.

### Setup: Hugging Face token + pyannote licence

Diarization uses pyannote's models, which require a one-time licence acceptance:

1. Create a free account at [huggingface.co](https://huggingface.co)
2. Visit [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) and click **Agree** to accept the licence
3. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → **New token** (read permission)
4. Copy the token into your `.env` as `HF_TOKEN=hf_...`

Without the token, WhisperX starts fine but diarization requests will fail at runtime.

### Connecting WhisperX to Mesynx AI

1. **Settings → AI Providers → Add Provider**
2. **Provider:** `Custom (OpenAI-compatible)`
3. **Nickname:** `Home GPU · WhisperX`
4. **API Key:** the value of `WHISPERX_API_KEY` in your `.env` (default: `sk-placeholder`)
5. **Base URL:**
   - `http://whisperx:8000/v1` — same Compose network
   - `http://<gpu-host>:8398/v1` — remote machine
6. **Test Connection** → save

### Triggering diarization

Use a model name containing the word **`diarize`** in Mesynx AI — for example:

```text
large-v3-turbo-diarize
```

Mesynx AI detects the `-diarize` suffix and sends the request as `diarized_json`, which activates WhisperX's full alignment + speaker pipeline. Any model name *without* `diarize` is treated as a standard transcription request.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `WHISPERX_API_KEY` | `sk-placeholder` | API key the server requires. Set in `.env`. |
| `HF_TOKEN` | *(empty)* | Hugging Face token for pyannote diarization models. |
| `WHISPERX_MODEL` | `large-v3-turbo` | Base Whisper model WhisperX uses. |
| `WHISPERX_BATCH_SIZE` | `16` | Audio chunks processed in parallel. Reduce to `8` on GPUs with < 16 GB VRAM. |

---

## Running only one service

```bash
# Only faster-whisper (no diarization needed)
docker compose up -d whisper

# Only WhisperX (diarization)
docker compose up -d whisperx
```

---

> **Note on LLMs vs. transcription models.** Models like Gemma, Llama, or GPT are text LLMs — they cannot transcribe audio and will error on `/v1/audio/transcriptions`. Use a Whisper-family model for transcription. An LLM is the right tool for the *summary / enhancement* step instead — Mesynx AI lets you configure those separately.
