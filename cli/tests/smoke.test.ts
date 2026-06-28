import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = resolve(__dirname, "..", "dist", "index.js");

function maybe(name: string, fn: () => void): void {
    if (existsSync(DIST)) {
        it(name, fn);
    } else {
        it.skip(`${name} (build dist first: pnpm --filter riffado build)`, fn);
    }
}

function runCli(args: string[]): string {
    // citty prints --help / --version via consola, which auto-silences when
    // it detects test mode (NODE_ENV=test, VITEST=true, CI=true). Strip
    // those signals from the child env so the spawned CLI behaves as a
    // real user invocation.
    const childEnv = { ...process.env };
    delete childEnv.VITEST;
    delete childEnv.VITEST_POOL_ID;
    delete childEnv.VITEST_WORKER_ID;
    delete childEnv.CI;
    childEnv.NODE_ENV = "production";
    childEnv.CONSOLA_LEVEL = "3";

    const result = spawnSync("node", [DIST, ...args], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (result.status !== 0) {
        throw new Error(
            `CLI exited with ${result.status}\nstdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
        );
    }
    return stdout + stderr;
}

describe("bundled CLI smoke", () => {
    maybe("--version prints the package version", () => {
        const out = runCli(["--version"]).trim();
        expect(out).toMatch(/\d+\.\d+\.\d+/);
    });

    maybe("--help lists subcommands", () => {
        const out = runCli(["--help"]);
        expect(out).toContain("login");
        expect(out).toContain("logout");
        expect(out).toContain("whoami");
        expect(out).toContain("recordings");
    });
});
