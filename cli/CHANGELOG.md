# Changelog

All notable changes to the `riffado` CLI are documented in this file. The CLI version is independent of the Riffado server version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-19

### Added

- Initial CLI release.
- `riffado login` / `logout` / `whoami` with API-key authentication (paste, `--api-key` flag, or `RIFFADO_API_KEY` env).
- `riffado recordings list|get|download` against `/api/v1/recordings`.
- Unified error envelope decoding with machine-readable `code` surfaced alongside human messages.
- Automatic retry on `429` honoring `Retry-After`, and on transient `5xx` with exponential backoff.
- Config stored at `~/.config/riffado/config.json` with mode `0600`.
- `--server` flag and `RIFFADO_SERVER` env for self-hosted instances.
