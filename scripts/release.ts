#!/usr/bin/env bun
/**
 * Release script for Riffado.
 *
 * Two phases, because `main` is protected and direct pushes are
 * rejected by required status checks.
 *
 * Phase 1 — open the release PR:
 *   bun scripts/release.ts <major|minor|patch>
 *   bun scripts/release.ts <x.y.z>
 *
 * Phase 2 — after the PR is merged, tag the release commit:
 *   bun scripts/release.ts finalize
 *
 * ---------------------------------------------------------------
 * Phase 1 steps:
 *   1. Verify clean working tree on main, in sync with origin/main.
 *   2. Bump version in package.json.
 *   3. Rewrite CHANGELOG.md: [Unreleased] -> [X.Y.Z] - <date>.
 *   4. Branch to `release/vX.Y.Z`.
 *   5. Commit `chore(release): vX.Y.Z`.
 *   6. Re-add empty [Unreleased] section, commit.
 *   7. Push branch (NO tag yet — tag is created in phase 2).
 *   8. Open a PR via `gh` with merge-commit guidance.
 *   9. Reset local main to origin/main so the maintainer isn't left
 *      "2 ahead" while the PR is in review.
 *
 * Phase 2 steps:
 *   1. Fetch origin.
 *   2. Read target version from package.json on origin/main.
 *   3. Refuse if the tag already exists locally or remotely.
 *   4. Locate the release commit on origin/main via
 *      `git log --grep="^chore(release): vX.Y.Z$"`.
 *   5. Create the tag pointing at that commit, push it.
 *   6. Delete the release/vX.Y.Z branch (local + remote).
 *
 * The tag push triggers docker.yml and release.yml. Per AGENTS.md,
 * agents do not invoke this — it's a maintainer action.
 *
 * Staged files in phase 1 are an explicit allowlist (package.json,
 * CHANGELOG.md). No `git add -A` / `git add .` — see AGENTS.md.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGET = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const STAGED_FILES = ["package.json", "CHANGELOG.md"];

function usage(): never {
	console.error("Usage:");
	console.error("  bun scripts/release.ts <major|minor|patch|x.y.z>   # phase 1: open PR");
	console.error("  bun scripts/release.ts finalize                    # phase 2: tag after merge");
	process.exit(1);
}

if (!TARGET) usage();

function run(cmd: string, opts: { silent?: boolean } = {}): string {
	if (!opts.silent) console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit" }) ?? "";
	} catch {
		console.error(`Command failed: ${cmd}`);
		process.exit(1);
	}
}

function tryRun(cmd: string, opts: { silent?: boolean } = {}): string | null {
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit" }) ?? "";
	} catch {
		return null;
	}
}

function readPkgVersion(): string {
	return JSON.parse(readFileSync("package.json", "utf-8")).version as string;
}

function readPkgVersionFromRef(ref: string): string {
	const raw = run(`git show ${ref}:package.json`, { silent: true });
	return JSON.parse(raw).version as string;
}

function compareVersions(a: string, b: string): number {
	const ap = a.split(".").map(Number);
	const bp = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (ap[i] ?? 0) - (bp[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

function bumpVersion(target: string): string {
	const current = readPkgVersion();
	if (BUMP_TYPES.has(target)) {
		run(`npm version ${target} --no-git-tag-version`);
	} else {
		if (compareVersions(target, current) <= 0) {
			console.error(`Error: ${target} must be greater than current ${current}.`);
			process.exit(1);
		}
		run(`npm version ${target} --no-git-tag-version`);
	}
	return readPkgVersion();
}

function updateChangelogForRelease(version: string): void {
	const date = new Date().toISOString().split("T")[0];
	const content = readFileSync("CHANGELOG.md", "utf-8");
	if (!content.includes("## [Unreleased]")) {
		console.error("Error: CHANGELOG.md has no [Unreleased] section.");
		process.exit(1);
	}

	const compareLinkPattern =
		/^\[unreleased\]: (https:\/\/github\.com\/riffado\/riffado\/compare\/)(v\d+\.\d+\.\d+)\.\.\.HEAD$/m;
	const compareLink = content.match(compareLinkPattern);
	if (!compareLink) {
		console.error(
			"Error: CHANGELOG.md has no valid [unreleased] comparison link.",
		);
		process.exit(1);
	}

	const [, compareBase, previousTag] = compareLink;
	const nextTag = `v${version}`;
	const links = [
		`[unreleased]: ${compareBase}${nextTag}...HEAD`,
		`[${version}]: ${compareBase}${previousTag}...${nextTag}`,
	].join("\n");
	const released = content
		.replace("## [Unreleased]", `## [${version}] - ${date}`)
		.replace(compareLinkPattern, links);
	writeFileSync("CHANGELOG.md", released);
}

function addUnreleasedSection(): void {
	const content = readFileSync("CHANGELOG.md", "utf-8");
	writeFileSync("CHANGELOG.md", content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n"));
}

function stage(): void {
	run(`git add -- ${STAGED_FILES.join(" ")}`);
}

function assertGhAvailable(): void {
	const ok = tryRun("gh auth status", { silent: true });
	if (ok === null) {
		console.error("Error: `gh` CLI not available or not authenticated. Run `gh auth login`.");
		process.exit(1);
	}
}

function assertCleanOnMainInSync(): void {
	const branch = run("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
	if (branch !== "main") {
		console.error(`Error: must release from main, currently on '${branch}'.`);
		process.exit(1);
	}
	const status = run("git status --porcelain", { silent: true }).trim();
	if (status) {
		console.error("Error: uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
	run("git fetch origin main --tags", { silent: true });
	const local = run("git rev-parse main", { silent: true }).trim();
	const remote = run("git rev-parse origin/main", { silent: true }).trim();
	if (local !== remote) {
		console.error("Error: local main is not in sync with origin/main.");
		console.error(`  local : ${local}`);
		console.error(`  remote: ${remote}`);
		console.error("Run `git pull --rebase` (or reconcile manually) and retry.");
		process.exit(1);
	}
}

function phase1(target: string): void {
	console.log("\n=== Riffado Release — Phase 1 (open PR) ===\n");
	assertGhAvailable();
	assertCleanOnMainInSync();

	console.log("Bumping version...");
	const version = bumpVersion(target);
	const branch = `release/v${version}`;
	console.log(`  -> ${version}\n`);

	// Bail early if the branch or tag already exists anywhere — otherwise
	// we end up with a half-finished release and the user has to clean up
	// twice. Cheaper to refuse up front.
	if (tryRun(`git rev-parse --verify ${branch}`, { silent: true }) !== null) {
		console.error(`Error: local branch '${branch}' already exists. Delete it or finish the prior release.`);
		process.exit(1);
	}
	const remoteBranch = tryRun(`git ls-remote --exit-code --heads origin ${branch}`, { silent: true });
	if (remoteBranch !== null) {
		console.error(`Error: remote branch '${branch}' already exists on origin.`);
		process.exit(1);
	}
	const localTag = tryRun(`git rev-parse --verify refs/tags/v${version}`, { silent: true });
	if (localTag !== null) {
		console.error(`Error: tag v${version} already exists locally.`);
		process.exit(1);
	}
	const remoteTag = tryRun(`git ls-remote --exit-code --tags origin refs/tags/v${version}`, { silent: true });
	if (remoteTag !== null) {
		console.error(`Error: tag v${version} already exists on origin.`);
		process.exit(1);
	}

	console.log("Updating CHANGELOG.md...");
	updateChangelogForRelease(version);

	console.log(`Creating branch ${branch}...`);
	run(`git checkout -b ${branch}`);

	console.log("Committing release...");
	stage();
	run(`git commit -m "chore(release): v${version}"`);

	console.log("Adding [Unreleased] section for next cycle...");
	addUnreleasedSection();
	stage();
	run(`git commit -m "chore: add [Unreleased] section for next cycle"`);

	console.log("\nPushing release branch...");
	run(`git push -u origin ${branch}`);

	console.log("\nOpening PR...");
	const prBody = [
		`Release v${version}.`,
		"",
		"**Merge instructions:**",
		"",
		'Use **"Create a merge commit"** (not squash). The release commit\'s message',
		"is used by `bun scripts/release.ts finalize` to locate the commit to tag.",
		"Squash-merge still works (GitHub uses the PR title as the squash subject),",
		"but a merge commit preserves history more cleanly.",
		"",
		"After this PR is merged, run:",
		"",
		"```bash",
		"bun scripts/release.ts finalize",
		"```",
		"",
		"That will create and push the `v" + version + "` tag, which triggers",
		"`docker.yml` and `release.yml`.",
	].join("\n");

	// Write the PR body to a temp file rather than passing it inline — long
	// multiline strings on the shell command line get mangled by quoting.
	// Use mkdtempSync for a fresh, unpredictable directory so a pre-planted
	// symlink in the system temp dir can't redirect the write
	// (js/insecure-temporary-file).
	const tmpDir = mkdtempSync(join(tmpdir(), "riffado-release-"));
	const bodyPath = join(tmpDir, `pr-body-v${version}.md`);
	writeFileSync(bodyPath, prBody);
	run(
		`gh pr create --base main --head ${branch} --title "chore(release): v${version}" --body-file ${bodyPath}`,
	);

	// Restore local main so we aren't left "2 ahead" with stale package.json
	// + CHANGELOG.md edits while the PR sits in review. The branch we pushed
	// is the source of truth for the release commits now.
	console.log("\nRestoring local main to origin/main...");
	run("git checkout main");
	run(`git branch -D ${branch}`);

	console.log(`\n=== Phase 1 complete: PR opened for v${version} ===`);
	console.log("Next steps:");
	console.log("  1. Wait for required checks on the PR to pass.");
	console.log("  2. Merge the PR (merge commit preferred; squash works too).");
	console.log("  3. Run: bun scripts/release.ts finalize");
}

function phase2Finalize(): void {
	console.log("\n=== Riffado Release — Phase 2 (finalize) ===\n");

	console.log("Fetching origin...");
	run("git fetch origin main --tags", { silent: true });

	const version = readPkgVersionFromRef("origin/main");
	console.log(`Target version (from origin/main package.json): ${version}`);

	const localTag = tryRun(`git rev-parse --verify refs/tags/v${version}`, { silent: true });
	if (localTag !== null) {
		console.error(`Error: tag v${version} already exists locally. Aborting to avoid double-tagging.`);
		process.exit(1);
	}
	const remoteTag = tryRun(`git ls-remote --exit-code --tags origin refs/tags/v${version}`, { silent: true });
	if (remoteTag !== null) {
		console.error(`Error: tag v${version} already exists on origin. Aborting.`);
		process.exit(1);
	}

	// Find the release commit on origin/main. The release commit's subject
	// is `chore(release): vX.Y.Z`. GitHub's default squash subject is the
	// PR title, which we set to the same string, so this --grep works for
	// both merge-commit and squash-merge PRs.
	//
	// Two non-obvious things going on here:
	//   1. The grep pattern is SINGLE-QUOTED inside the JS template so the
	//      backslashes (`\(` / `\)`) survive `/bin/sh -c`. Without quoting,
	//      sh strips them and git sees `^chore(release): vX.Y.Z$` under
	//      `--extended-regexp`, where `(release)` becomes a capture group
	//      around the literal text "release" and the pattern stops matching
	//      the actual commit subject `chore(release): vX.Y.Z`. Result was
	//      zero matches and `Error: no commit on origin/main matches`.
	//   2. `--no-merges` excludes GitHub's auto-generated merge commit,
	//      whose body includes the PR title verbatim. Without it the grep
	//      finds BOTH the release commit and its merge commit and the
	//      script bails with `multiple commits match`. Squash-merge PRs
	//      produce a non-merge commit, so this stays compatible.
	const matches = run(
		`git log origin/main --no-merges --grep='^chore\\(release\\): v${version}$' --extended-regexp --format=%H`,
		{ silent: true },
	)
		.trim()
		.split("\n")
		.filter(Boolean);

	if (matches.length === 0) {
		console.error(`Error: no commit on origin/main matches 'chore(release): v${version}'.`);
		console.error("Was the PR merged? Did the subject get rewritten?");
		process.exit(1);
	}
	if (matches.length > 1) {
		console.error(`Error: multiple commits on origin/main match 'chore(release): v${version}':`);
		for (const sha of matches) console.error(`  ${sha}`);
		console.error("Resolve manually with `git tag v" + version + " <sha> && git push origin v" + version + "`.");
		process.exit(1);
	}
	const sha = matches[0];
	console.log(`Release commit: ${sha}`);

	console.log("Tagging and pushing...");
	run(`git tag v${version} ${sha}`);
	run(`git push origin v${version}`);

	// Best-effort branch cleanup. Don't fail the whole finalize if these
	// don't exist — the user may have already deleted them via the GitHub
	// UI's "Delete branch" button after merge.
	const branch = `release/v${version}`;
	console.log(`\nCleaning up ${branch} (best effort)...`);
	tryRun(`git branch -D ${branch}`, { silent: true });
	tryRun(`git push origin --delete ${branch}`, { silent: true });

	console.log(`\n=== Released v${version} ===`);
	console.log("Next steps:");
	console.log("  1. Wait for docker.yml + release.yml workflows.");
	console.log("  2. Review and publish the draft GitHub Release.");
}

if (TARGET === "finalize") {
	phase2Finalize();
} else if (BUMP_TYPES.has(TARGET) || SEMVER_RE.test(TARGET)) {
	phase1(TARGET);
} else {
	usage();
}
