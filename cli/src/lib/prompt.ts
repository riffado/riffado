/**
 * Tiny prompt helpers — kept dependency-free so the CLI install footprint
 * stays small.
 *
 * `promptSecret()` masks input by suppressing echo (raw mode) while still
 * accepting paste. Falls back to readline (visible) when stdin is not a
 * TTY (CI, piped input).
 */

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";

export async function promptSecret(question: string): Promise<string> {
    if (!stdin.isTTY) {
        // No TTY: read line from stdin without masking. Common in CI where
        // the caller pipes the secret in.
        const rl = createInterface({ input: stdin });
        return new Promise<string>((resolve) => {
            rl.once("line", (line) => {
                rl.close();
                resolve(line);
            });
        });
    }

    stdout.write(question);
    return new Promise<string>((resolve, reject) => {
        const chunks: string[] = [];
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf-8");

        const onData = (chunk: string): void => {
            for (const char of chunk) {
                const code = char.charCodeAt(0);
                if (char === "\n" || char === "\r") {
                    cleanup();
                    stdout.write("\n");
                    resolve(chunks.join(""));
                    return;
                }
                if (code === 3) {
                    // Ctrl-C
                    cleanup();
                    stdout.write("\n");
                    reject(new Error("Cancelled"));
                    return;
                }
                if (code === 4) {
                    // Ctrl-D
                    cleanup();
                    stdout.write("\n");
                    resolve(chunks.join(""));
                    return;
                }
                if (char === "\u007f" || char === "\b") {
                    if (chunks.length > 0) chunks.pop();
                    continue;
                }
                if (code < 32) continue; // ignore other control chars
                chunks.push(char);
            }
        };

        const cleanup = (): void => {
            stdin.removeListener("data", onData);
            stdin.setRawMode(wasRaw);
            stdin.pause();
        };

        stdin.on("data", onData);
    });
}
