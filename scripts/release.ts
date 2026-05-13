#!/usr/bin/env bun
/**
 * Release script for OpenPlaud.
 *
 * Usage:
 *   bun scripts/release.ts <major|minor|patch>
 *   bun scripts/release.ts <x.y.z>
 *
 * Steps:
 *   1. Verify clean working tree on main
 *   2. Bump version in package.json
 *   3. Rewrite CHANGELOG.md: [Unreleased] -> [X.Y.Z] - <date>
 *   4. Commit (release commit), tag vX.Y.Z
 *   5. Re-add empty [Unreleased] section, commit
 *   6. Push main + tag in one atomic push
 *
 * The push is atomic on purpose: if `main` has diverged on the remote,
 * the whole push fails and the tag isn't published, so we never end up
 * in a state where the tag exists but `main` doesn't include the
 * version bump (that's how `package.json` drifted to `0.2.0` behind
 * `v0.4.1` before — see issue #123). Rebase locally and rerun.
 *
 * After push, GitHub workflows (docker.yml, release.yml) take over.
 * Per AGENTS.md, agents do not invoke this — it's a maintainer action.
 *
 * Files staged are explicitly listed (package.json, CHANGELOG.md). No
 * `git add -A` / `git add .` — see AGENTS.md.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TARGET = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const STAGED_FILES = ["package.json", "CHANGELOG.md"];

if (!TARGET || (!BUMP_TYPES.has(TARGET) && !SEMVER_RE.test(TARGET))) {
	console.error("Usage: bun scripts/release.ts <major|minor|patch|x.y.z>");
	process.exit(1);
}

function run(cmd: string, opts: { silent?: boolean } = {}): string {
	if (!opts.silent) console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit" }) ?? "";
	} catch {
		console.error(`Command failed: ${cmd}`);
		process.exit(1);
	}
}

function readPkg(): { version: string } {
	return JSON.parse(readFileSync("package.json", "utf-8"));
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
	const current = readPkg().version;
	if (BUMP_TYPES.has(target)) {
		run(`npm version ${target} --no-git-tag-version`);
	} else {
		if (compareVersions(target, current) <= 0) {
			console.error(`Error: ${target} must be greater than current ${current}.`);
			process.exit(1);
		}
		run(`npm version ${target} --no-git-tag-version`);
	}
	return readPkg().version;
}

function updateChangelogForRelease(version: string): void {
	const date = new Date().toISOString().split("T")[0];
	const content = readFileSync("CHANGELOG.md", "utf-8");
	if (!content.includes("## [Unreleased]")) {
		console.error("Error: CHANGELOG.md has no [Unreleased] section.");
		process.exit(1);
	}
	writeFileSync("CHANGELOG.md", content.replace("## [Unreleased]", `## [${version}] - ${date}`));
}

function addUnreleasedSection(): void {
	const content = readFileSync("CHANGELOG.md", "utf-8");
	writeFileSync("CHANGELOG.md", content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n"));
}

function stage(): void {
	run(`git add -- ${STAGED_FILES.join(" ")}`);
}

function assertCleanOnMain(): void {
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
}

console.log("\n=== OpenPlaud Release ===\n");

assertCleanOnMain();

console.log("Bumping version...");
const version = bumpVersion(TARGET);
console.log(`  -> ${version}\n`);

console.log("Updating CHANGELOG.md...");
updateChangelogForRelease(version);

console.log("Committing release...");
stage();
run(`git commit -m "chore(release): v${version}"`);
run(`git tag v${version}`);

console.log("Adding [Unreleased] section for next cycle...");
addUnreleasedSection();
stage();
run(`git commit -m "chore: add [Unreleased] section for next cycle"`);

console.log("\nPushing main + tag atomically...");
// `--atomic` makes the push a single transaction: either every ref
// update lands or none of them do. Without it, git pushes refs
// sequentially and the tag could be published while `main` is
// rejected (or vice versa) -- the exact half-state we're trying to
// prevent.
//
// If the push fails (diverged remote, server-side hook reject), the
// local tag and the two new commits stay on the local main. We catch
// the failure explicitly here so we can print recovery commands
// rather than dying through run()'s generic handler -- otherwise the
// maintainer's next attempt trips on `git tag` (already exists) and
// `assertCleanOnMain` (the two commits are ahead of origin/main).
try {
	execSync(`git push --atomic origin main v${version}`, { stdio: "inherit" });
} catch {
	console.error("\nError: push failed. Local state still has:");
	console.error(`  - tag v${version}`);
	console.error("  - 2 commits ahead of origin/main (release + [Unreleased] cycle)");
	console.error("\nTo retry after rebasing:");
	console.error(`  git tag -d v${version}`);
	console.error("  git reset --hard origin/main");
	console.error("  git pull --rebase origin main");
	console.error("  bun scripts/release.ts <target>");
	process.exit(1);
}

console.log(`\n=== Released v${version} ===`);
console.log("Next steps:");
console.log("  1. Wait for docker.yml + release.yml workflows");
console.log("  2. Review and publish the draft GitHub Release");
