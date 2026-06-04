---
description: Audit and update CHANGELOG.md before a release (maintainer only)
---
Audit `CHANGELOG.md` against commits since the last release. **This is a maintainer release-time task** — do not run on contributor branches.

## Process

1. **Find the last release tag:**
   ```bash
   git tag --sort=-version:refname | head -1
   ```

2. **List all commits since that tag:**
   ```bash
   git log <tag>..HEAD --oneline
   ```

3. **Read the full `## [Unreleased]` section in `CHANGELOG.md`** to see which subsections already exist and what's been recorded.

4. **For each commit, check:**
   - Skip: changelog updates, doc-only changes (unless user-facing copy), release housekeeping, dependency bumps without behavior change
   - Determine the right subsection: `Breaking Changes`, `Added`, `Changed`, `Fixed`, `Removed`, `Security`
   - Verify a corresponding entry exists under `## [Unreleased]`
   - Use `git show <hash> --stat` and `git show <hash>` to confirm scope and intent
   - For external contributions (PRs from non-maintainers), entry must include PR link and author: `Added Groq provider ([#456](https://github.com/mesynx-ai/mesynx-ai/pull/456) by [@username](https://github.com/username))`
   - For internal changes: `Fixed sync stall on 429 ([#123](https://github.com/mesynx-ai/mesynx-ai/issues/123))`

5. **Deploy-surface flagging:** any commit that touches `src/db/schema.ts`, `src/lib/env.ts`, `docker-compose.yml`, or the install flow must have a `Breaking Changes` entry with a migration note if it's not strictly additive. Per AGENTS.md, breaking changes ship with loud logging + Sentry context + CHANGELOG notes.

6. **Report:**
   - Commits with missing entries (propose exact text + subsection)
   - Entries in the wrong subsection (e.g., a breaking change filed under `Fixed`)
   - Entries missing PR/author attribution
   - Add missing entries directly to `## [Unreleased]` after I confirm the proposed text

## Rules (from AGENTS.md)

- New entries ALWAYS go under `## [Unreleased]`. Append to existing subsections; do not duplicate.
- NEVER modify already-released version sections (`## [0.1.0]`, etc.) — each is immutable once released.
- Subsection order: `Breaking Changes`, `Added`, `Changed`, `Fixed`, `Removed`, `Security`.
