---
description: Review PRs from URLs with structured issue and code analysis
argument-hint: "<PR-URL>"
---
You are given one or more GitHub PR URLs: $@

For each PR URL, do the following in order:

1. Read the PR page in full. Include description, all comments, all commits, and all changed files (`gh pr view <url> --json ...` plus `gh pr diff`).
2. Identify any linked issues referenced in the PR body, comments, commit messages, or cross links. Read each issue in full, including all comments.
3. Analyze the PR diff. Read all relevant code files in full from the current `main` branch (Read tool only — never `cat`/`sed`) and compare against the diff. Include related code paths that are not in the diff but are required to validate behavior.
4. **Do not** check for a `CHANGELOG.md` entry — per AGENTS.md, the changelog is maintainer-curated at release time and contributors do not edit it. Instead, note in the review whether this change is release-worthy and which subsection it should land in (`Added` / `Changed` / `Fixed` / `Breaking Changes` / `Removed` / `Security`) so the maintainer can pick it up at release.
5. Cross-check against Mesynx AI invariants from AGENTS.md:
   - **Deploy surface**: schema additivity, env var deprecation, `docker-compose.yml` structure
   - **User-scoped queries**: every user-scoped query must include `eq(table.userId, session.user.id)`
   - **Encryption at rest**: tokens, AI keys, SMTP, S3 creds go through `src/lib/encryption.ts`
   - **Self-host first-class**: must run in `docker compose up`
   - **Local-AI path**: Transformers.js + Ollama/LM Studio must keep working
   - **Sync regression risk**: if `src/lib/sync/` or `src/lib/plaud/` is touched, flag for real-account testing
6. Check if `README.md`, `BRANCHING.md`, or other docs need updates for user-visible changes.
7. Provide a structured review with these sections:
   - **Good**: solid choices or improvements
   - **Bad**: concrete issues, regressions, missing tests, or risks
   - **Ugly**: subtle or high-impact problems (security, deploy-surface, sync)
8. Add **Questions or Assumptions** if anything is unclear.
9. Add **Change summary** and **Tests**.

Output format per PR:

```
PR: <url>
Release-worthy: yes/no — section: <Added|Changed|Fixed|Breaking|Removed|Security>
Good:
- ...
Bad:
- ...
Ugly:
- ...
Questions or Assumptions:
- ...
Change summary:
- ...
Tests:
- ...
```

If no issues are found, say so under Bad and Ugly.

Do NOT pull the PR locally or merge it. Analysis only, unless I explicitly approve the merge — then follow the AGENTS.md PR workflow.
