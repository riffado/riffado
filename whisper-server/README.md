# Self-hosted GPU transcription (Whisper)

A standalone [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) you can run on
any NVIDIA GPU box. It exposes the **OpenAI-compatible** `/v1/audio/transcriptions` endpoint, which is
what Mesynx AI needs to transcribe your recordings on your own hardware — no cloud transcription API.

> **Why this exists.** Chat-only local servers like **Ollama** and **Open WebUI** don't implement the
> audio endpoint — they return `405 Method Not Allowed` on `/v1/audio/transcriptions`. faster-whisper-server
> does, so it slots in cleanly as a Mesynx AI provider. The same service ships in the main
> [`docker-compose.yml`](../docker-compose.yml); use the compose file here if you'd rather run Whisper on a
> separate machine from the app.

## Requirements

- An NVIDIA GPU + recent drivers
- Docker + the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

## Quick start

```bash
cd whisper-server
docker compose up -d

# Verify it's serving the OpenAI audio API:
curl http://localhost:8397/v1/models
```

On WSL or a flaky network, pull the image **on the GPU host directly** rather than through a proxy:

```bash
docker pull fedirz/faster-whisper-server:latest-cuda
```

Models download on first use and are cached in the `whisper_cache` volume, so they survive restarts.

## Connecting it to Mesynx AI

1. In Mesynx AI, open **Settings → AI Providers → Add Provider**.
2. **Provider:** `Custom (OpenAI-compatible)`.
3. **Nickname:** anything memorable, e.g. `Home GPU · faster-whisper`.
4. **Base URL:**
   - `http://whisper:8000/v1` if Mesynx AI runs in the *same* Compose network, or
   - `http://<gpu-host>:8397/v1` from another machine (a Tailscale IP works great).
5. Click **Test Connection** — Mesynx AI discovers the available models and fills the **searchable model picker**.
6. Pick a model (see below), tick **Use for transcription**, and save.

The model you choose here is sent with every transcription request, so you can switch models without
touching the server.

## Choosing a model

| Model | Best for | Notes |
| --- | --- | --- |
| `Systran/faster-whisper-large-v3` | Highest accuracy | Most accurate, but **most prone to hallucinating on long silences** — pair it with VAD (below). |
| `deepdml/faster-whisper-large-v3-turbo-ct2` | **Long recordings (recommended default)** | Near large-v3 quality, much faster, noticeably fewer runaway repetitions. Great for hour-long audio. |
| `Systran/faster-whisper-medium` | Modest GPUs | Solid quality at lower VRAM. |
| `distil-whisper/distil-large-v3` | English long-form | Distilled for speed; tends to stay on-task across long files. |

If you've been seeing hallucinations with `large-v3`, switch to **`deepdml/faster-whisper-large-v3-turbo-ct2`**
first — it's the single biggest quality-of-life change for long recordings.

## Taming hallucinations on long recordings

Whisper models invent text during **long silences** or noisy gaps — you get repeated phrases or
sentences that were never spoken. Two things help, in order of impact:

1. **Enable VAD (Voice Activity Detection).** faster-whisper can skip non-speech segments before they
   ever reach the model (`vad_filter`), which is the most effective fix for long-form audio. See the
   [faster-whisper-server configuration](https://github.com/fedirz/faster-whisper-server#configuration)
   for enabling it on your version.
2. **Prefer a turbo / distil model** (table above) — they drift less on long inputs than `large-v3`.

> **Note on LLMs vs. transcription models.** Models like **Gemma**, Llama, or GPT are *text* LLMs — they
> do **not** transcribe audio and can't be pointed at `/v1/audio/transcriptions`. Use a **Whisper-family**
> model for transcription. An LLM is the right tool for the *summary / enhancement* provider instead
> (Mesynx AI lets you configure those separately), where something like Gemma can clean up and summarize
> the Whisper transcript.
