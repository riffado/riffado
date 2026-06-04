# Branching & Release Model

Mesynx AI uses a **rolling-trunk + tagged-release** model. Self-hosters consume releases, not branches.

## Branches

| Branch | What it is | Who uses it |
|--------|------------|-------------|
| `main` | Rolling integration branch. Feature branches squash-merge here as they land. May be broken at any commit. | Contributors, CI, the `dev` Docker tag |
| `feature/*`, `fix/*`, etc. | Short-lived branches that open PRs into `main`. | Contributors |

**`main` is not a deployment target.** Do not `git clone && docker compose up --build` against `main` for production use.

## Releases

Stable versions are cut as **git tags** (`v0.1.0`, `v0.2.0`, …) from `main` when the tree is in a known-good state. Tagging triggers two workflows:

- **`docker.yml`** — builds multi-arch images on `ghcr.io/mesynx-ai/mesynx-ai` and tags them `:X.Y.Z`, `:X.Y`, and `:latest`.
- **`release.yml`** — drafts a GitHub Release with generated notes and attaches `docker-compose.yml` + `.env.example` as install artifacts.

Every push to `main` additionally publishes `:dev` — opt-in rolling image for users who explicitly want the bleeding edge. `:latest` deliberately does **not** track `main`.

## Cutting a release

`main` is protected with required status checks, so releases go through a PR like everything else. The release script handles this in two phases.

### Phase 1 — open the release PR

From a clean `main` that's in sync with `origin/main`:

```bash
bun scripts/release.ts <major|minor|patch>
# or an explicit version:
bun scripts/release.ts 0.6.0
```

This bumps `package.json`, rewrites `## [Unreleased]` → `## [X.Y.Z] - <date>` in `CHANGELOG.md`, re-adds an empty `[Unreleased]` section, commits both on a `release/vX.Y.Z` branch, pushes the branch, and opens a PR via `gh`. **No tag is created yet.** Local `main` is restored to `origin/main` before the script exits so the working tree stays clean while the PR is in review.

### Phase 2 — finalize after merge

Wait for the required checks to pass, then merge the PR. Merge-commit is preferred (preserves the release commit's SHA on `main`); squash also works because GitHub uses the PR title as the squash subject, which matches the pattern the finalize step greps for.

Then:

```bash
bun scripts/release.ts finalize
```

This fetches `origin/main`, reads the merged version from `package.json`, finds the release commit by message, creates and pushes the `vX.Y.Z` tag, and deletes the `release/vX.Y.Z` branch. The tag push triggers `docker.yml` and `release.yml`.

### After both phases

1. Wait for `docker.yml` and `release.yml` to finish.
2. Review the draft release on GitHub, edit notes if needed, publish.

## Hotfixes (when needed)

If a released version has an urgent bug and `main` has already diverged with unrelated changes:

1. Fix the bug on `main` first.
2. Branch from the release tag: `git checkout -b release-0.1 v0.1.0`.
3. Cherry-pick the fix. Push.
4. Tag `v0.1.1` from that branch and push.

If `main` is still shippable, just cut a normal release from `main` instead.
