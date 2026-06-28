#!/usr/bin/env bun
/**
 * Release script for the Riffado CLI (separate from the web app).
 *
 * Usage:
 *   bun scripts/release-cli.ts <major|minor|patch>
 *   bun scripts/release-cli.ts <x.y.z>
 *
 * Steps:
 *   1. Verify clean working tree on main.
 *   2. Bump cli/package.json version.
 *   3. Rewrite cli/CHANGELOG.md: [Unreleased] -> [X.Y.Z] - <date>.
 *   4. Commit (release commit), tag cli-vX.Y.Z.
 *   5. Push tag (NOT main — release commit goes through normal review/push).
 *   6. Re-add empty [Unreleased] section in cli/CHANGELOG.md, commit.
 *
 * The tag push triggers .github/workflows/release-cli.yml which publishes
 * to npm with provenance. Maintainer action — agents do not invoke this.
 *
 * Mirrors `scripts/release.ts`. Never touches root package.json.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const TARGET = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const STAGED_FILES = ["cli/package.json", "cli/CHANGELOG.md"];

if (!TARGET || (!BUMP_TYPES.has(TARGET) && !SEMVER_RE.test(TARGET))) {
    console.error("Usage: bun scripts/release-cli.ts <major|minor|patch|x.y.z>");
    process.exit(1);
}

function run(cmd: string, opts: { silent?: boolean; cwd?: string } = {}): string {
    if (!opts.silent) console.log(`$ ${cmd}`);
    try {
        return (
            execSync(cmd, {
                encoding: "utf-8",
                stdio: opts.silent ? "pipe" : "inherit",
                cwd: opts.cwd,
            }) ?? ""
        );
    } catch {
        console.error(`Command failed: ${cmd}`);
        process.exit(1);
    }
}

// Like run() but spawns without a shell, so caller-supplied values (e.g. the
// version arg from argv) cannot be interpreted as shell syntax.
function runFile(file: string, args: string[], opts: { cwd?: string } = {}): string {
    console.log(`$ ${file} ${args.join(" ")}`);
    try {
        return (
            execFileSync(file, args, {
                encoding: "utf-8",
                stdio: "inherit",
                cwd: opts.cwd,
            }) ?? ""
        );
    } catch {
        console.error(`Command failed: ${file} ${args.join(" ")}`);
        process.exit(1);
    }
}

function readPkg(): { version: string } {
    return JSON.parse(readFileSync("cli/package.json", "utf-8"));
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
    if (!BUMP_TYPES.has(target) && compareVersions(target, current) <= 0) {
        console.error(`Error: ${target} must be greater than current ${current}.`);
        process.exit(1);
    }
    runFile("npm", ["version", target, "--no-git-tag-version"], { cwd: "cli" });
    return readPkg().version;
}

function updateChangelogForRelease(version: string): void {
    const date = new Date().toISOString().split("T")[0];
    const path = "cli/CHANGELOG.md";
    const content = readFileSync(path, "utf-8");
    if (!content.includes("## [Unreleased]")) {
        console.error("Error: cli/CHANGELOG.md has no [Unreleased] section.");
        process.exit(1);
    }
    writeFileSync(path, content.replace("## [Unreleased]", `## [${version}] - ${date}`));
}

function addUnreleasedSection(): void {
    const path = "cli/CHANGELOG.md";
    const content = readFileSync(path, "utf-8");
    writeFileSync(path, content.replace(/^(# Changelog\n\n[\s\S]*?\n\n)/, "$1## [Unreleased]\n\n"));
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

console.log("\n=== Riffado CLI Release ===\n");

assertCleanOnMain();

console.log("Bumping CLI version...");
const version = bumpVersion(TARGET);
console.log(`  -> ${version}\n`);

console.log("Updating cli/CHANGELOG.md...");
updateChangelogForRelease(version);

console.log("Committing release...");
stage();
run(`git commit -m "chore(cli): release v${version}"`);
run(`git tag cli-v${version}`);

console.log("\nPushing tag (not main — push the release commit yourself after review)...");
run(`git push origin cli-v${version}`);

console.log("\nAdding [Unreleased] section for next cycle...");
addUnreleasedSection();
stage();
run(`git commit -m "chore(cli): add [Unreleased] section for next cycle"`);

console.log(`\n=== Tagged cli-v${version} ===`);
console.log("Next steps:");
console.log("  1. git push origin main   # pushes release commit + [Unreleased] commit");
console.log("  2. Wait for release-cli.yml workflow to publish to npm");
console.log("  3. Verify https://www.npmjs.com/package/riffado shows the new version");
