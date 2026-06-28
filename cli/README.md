# riffado

Command-line interface for [Riffado](https://github.com/riffado/riffado). Access your recordings, transcripts, and summaries from the terminal.

Works against both the hosted instance at `https://riffado.com` and any self-hosted Riffado server.

## Install

```sh
npm install -g riffado
```

Requires Node.js 20+.

## Quick start

1. Open Riffado → **Settings → API Keys** → **Create new key**.
2. Copy the `op_…` key (shown once).
3. Authenticate the CLI:

    ```sh
    riffado login
    ```

    Paste the key when prompted. Use `--server https://my-riffado.example.com` to point at a self-hosted instance.

4. List your recordings:

    ```sh
    riffado recordings list
    ```

## Commands

| Command                              | Description                                                            |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `riffado login`                    | Store an API key locally after validating it against the server.       |
| `riffado logout`                   | Remove the local key. `--revoke` also deletes it on the server.        |
| `riffado whoami`                   | Show the configured server, masked key, and probe connectivity.        |
| `riffado recordings list`          | List recordings (`--limit`, `--cursor`, `--json`).                     |
| `riffado recordings get <id>`      | Fetch one recording with transcript and summary (`--json`).            |
| `riffado recordings download <id>` | Download the audio file. `--out` overrides the default `<id>.<ext>`.   |

All commands accept `--help`.

## Authentication

The CLI sends `Authorization: Bearer <api-key>` to the configured server. Three ways to supply the key, in order of precedence:

1. `--api-key <key>` flag (one-off).
2. `RIFFADO_API_KEY` environment variable.
3. Stored in `~/.config/riffado/config.json` after `riffado login` (file mode `0600`).

`--server <url>`, `RIFFADO_SERVER`, and the stored `server` field follow the same precedence. Default is `https://riffado.com`.

The key never leaves your machine. The CLI does not phone home — every request is to the server you configured.

## Output

Most commands accept `--json` for piping into `jq`. Without it, output is plain text aimed at humans.

`recordings list` prints one line per recording: `id  [TS]  recorded_at  duration  filesize  title`, where `[TS]` flags `T`ranscript and `S`ummary availability.

## Exit codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Success.                                                           |
| `1`  | Any error (auth, network, API, validation).                        |

The error code from the unified `{error, code, details}` envelope is printed alongside the message, e.g. `error [RATE_LIMITED]: Rate limit exceeded`.

## Server compatibility

| CLI version | Minimum server version |
| ----------- | ---------------------- |
| `0.1.x`     | `0.4.2`                |

Older servers may not have `/api/v1/recordings` or the unified error envelope.

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). Source at <https://github.com/riffado/riffado>.
