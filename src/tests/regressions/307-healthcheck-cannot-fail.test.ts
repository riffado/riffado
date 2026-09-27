/**
 * Regression test for issue #307: the app healthcheck in docker-compose.yml
 * reported `healthy` unconditionally.
 *
 * Two faults combined. The probe targeted `localhost:3000`, but the
 * standalone server binds `process.env.HOSTNAME || '0.0.0.0'` and Docker
 * always sets HOSTNAME, so loopback was refused even on a healthy
 * container. The probe then had no listener for the request's `error`
 * event. Under the Bun version baked into the published images that
 * exits 0 on a refused connection, so the check reported healthy. See
 * issue #290.
 *
 * These tests run the literal probe string out of docker-compose.yml, so
 * they fail if the healthcheck is ever edited back into a shape that
 * cannot report a failure.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");

/** The exact ["CMD", "node", "-e", "..."] the healthcheck runs. */
function probeScript(): string {
    const line = compose
        .split("\n")
        .find((l) => l.trim().startsWith('test: ["CMD", "node"'));
    if (!line) throw new Error("app healthcheck test line not found");
    const argv = JSON.parse(line.slice(line.indexOf("["))) as string[];
    return argv[3] as string;
}

/**
 * Spawned asynchronously on purpose. The test server runs in this same
 * process, so a synchronous spawn would block the event loop and the
 * probe would time out against a server that never gets to accept it.
 */
function runProbe(host: string, port: number): Promise<number> {
    return new Promise((resolve) => {
        const child = execFile(process.execPath, ["-e", probeScript()], {
            env: { ...process.env, HOSTNAME: host, PORT: String(port) },
            timeout: 10_000,
        });
        child.on("close", (code) => resolve(code ?? -1));
    });
}

const servers: Server[] = [];

/**
 * Bind an ephemeral port, then release it, and report the number. That
 * gives a port nothing is listening on. A hardcoded number cannot promise
 * that: 59999 sits inside the ephemeral range on both Linux and macOS, so
 * anything answering there would turn a correct healthcheck into a failing
 * test.
 */
function closedPort(): Promise<number> {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => resolve(port));
        });
    });
}

function listen(handler: (status: number) => number): Promise<number> {
    return new Promise((resolve) => {
        const server = createServer((_req, res) => {
            res.writeHead(handler(200));
            res.end("{}");
        });
        servers.push(server);
        server.listen(0, "127.0.0.1", () => {
            resolve((server.address() as { port: number }).port);
        });
    });
}

afterAll(() => {
    for (const s of servers) s.close();
});

describe("issue #307: the compose healthcheck must be able to fail", () => {
    it("exits 0 when the app answers 200", async () => {
        const port = await listen(() => 200);
        expect(await runProbe("127.0.0.1", port)).toBe(0);
    });

    it("exits non-zero when the app answers 500", async () => {
        const port = await listen(() => 500);
        expect(await runProbe("127.0.0.1", port)).not.toBe(0);
    });

    it("exits non-zero when nothing is listening", async () => {
        // The original defect: a refused connection reported healthy.
        expect(await runProbe("127.0.0.1", await closedPort())).not.toBe(0);
    });

    it("handles the request error event", () => {
        expect(probeScript()).toContain(".on('error'");
    });

    it("probes the address the server actually binds", () => {
        // server.js uses `process.env.HOSTNAME || '0.0.0.0'` and
        // `parseInt(process.env.PORT, 10) || 3000`. The probe must follow
        // both, or it cannot reach a healthy container.
        const script = probeScript();
        expect(script).toContain("process.env.HOSTNAME");
        expect(script).toContain("process.env.PORT");
    });
});
