import { createServer } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { describe, expect, it, vi } from "vitest";
import { fetchTranscription } from "@/lib/transcription/fetch";

describe("Node transcription dispatcher", () => {
    it("preserves the configured dispatcher and changes idle limits only for transcription", async () => {
        const previousDispatcher = getGlobalDispatcher();
        const dispatcher = new Agent({ headersTimeout: 100 });
        const dispatchSpy = vi.spyOn(dispatcher, "dispatch");
        const server = createServer((_request, response) => {
            const timer = setTimeout(() => response.end("complete"), 1500);
            response.once("close", () => clearTimeout(timer));
        });

        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Expected a TCP server address");
        }
        const origin = `http://127.0.0.1:${address.port}`;

        setGlobalDispatcher(dispatcher);
        try {
            const response = await fetchTranscription(
                `${origin}/transcription`,
                {},
                5000,
            );
            expect(await response.text()).toBe("complete");
            expect(getGlobalDispatcher()).toBe(dispatcher);

            await expect(fetch(`${origin}/ordinary`)).rejects.toMatchObject({
                cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
            });

            const transcriptionOptions = dispatchSpy.mock.calls.find(
                ([options]) => options.path === "/transcription",
            )?.[0];
            const ordinaryOptions = dispatchSpy.mock.calls.find(
                ([options]) => options.path === "/ordinary",
            )?.[0];
            expect(transcriptionOptions).toMatchObject({
                headersTimeout: 0,
                bodyTimeout: 0,
            });
            expect(ordinaryOptions).toBeDefined();
            expect(ordinaryOptions?.headersTimeout).not.toBe(0);
            expect(ordinaryOptions?.bodyTimeout).not.toBe(0);
        } finally {
            setGlobalDispatcher(previousDispatcher);
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
            await dispatcher.close();
            dispatchSpy.mockRestore();
        }
    });
});
