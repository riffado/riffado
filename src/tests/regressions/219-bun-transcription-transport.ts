import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchTranscription } from "../../lib/transcription/fetch";

assert.ok(process.versions.bun, "Run this regression with Bun");
assert.equal(process.env.BUN_CONFIG_HTTP_IDLE_TIMEOUT, "1");

const server = createServer((request, response) => {
    request.resume();
    if (request.url === "/headers") return;
    if (request.url === "/body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"text":');
        return;
    }
    const timer = setTimeout(() => response.end("complete"), 6500);
    response.once("close", () => clearTimeout(timer));
});

await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
});

try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const controlDeadline = AbortSignal.timeout(15000);

    await Promise.all([
        assert
            .rejects(fetch(`${url}/slow`, { signal: controlDeadline }), {
                name: "TimeoutError",
            })
            .then(() => {
                assert.equal(
                    controlDeadline.aborted,
                    false,
                    "The control must fail on Bun's idle limit",
                );
            }),
        fetchTranscription(`${url}/slow`, {}, 15000).then(async (response) => {
            assert.equal(await response.text(), "complete");
        }),
    ]);
    console.log(
        "PASS: native fetch hits the idle limit; transcription receives the delayed response",
    );

    await assert.rejects(fetchTranscription(`${url}/headers`, {}, 200), {
        name: "TimeoutError",
    });
    const response = await fetchTranscription(`${url}/body`, {}, 200);
    await assert.rejects(response.json(), { name: "TimeoutError" });
    console.log(
        "PASS: transcription deadlines abort stalled headers and response bodies",
    );
} finally {
    const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
    server.closeAllConnections();
    await closed;
}
