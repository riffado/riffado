import { describe, expect, test } from "vitest";
import {
    HOSTED_LOCAL_BASE_URL_MESSAGE,
    validateAiBaseUrl,
} from "@/lib/ai/validate-base-url";

describe("validateAiBaseUrl", () => {
    describe("self-host (isHosted=false)", () => {
        test("allows empty / nullish (use default)", () => {
            expect(validateAiBaseUrl("", { isHosted: false }).ok).toBe(true);
            expect(validateAiBaseUrl(null, { isHosted: false }).ok).toBe(true);
            expect(validateAiBaseUrl(undefined, { isHosted: false }).ok).toBe(
                true,
            );
        });

        test("allows localhost-style URLs (Ollama, LM Studio, docker network)", () => {
            const urls = [
                "http://localhost:1234/v1",
                "http://127.0.0.1:11434/v1",
                "http://0.0.0.0:8080/v1",
                "http://[::1]:1234/v1",
                "http://ollama:11434/v1",
                "https://api.openai.com/v1",
            ];
            for (const u of urls) {
                expect(
                    validateAiBaseUrl(u, { isHosted: false }),
                    `self-host should allow ${u}`,
                ).toEqual({ ok: true });
            }
        });

        test("self-host does not even bother to parse — garbage strings pass", () => {
            // Self-host trusts the operator; the OpenAI SDK will surface
            // a helpful error at request time. We don't try to second-guess.
            expect(validateAiBaseUrl("not a url", { isHosted: false }).ok).toBe(
                true,
            );
        });
    });

    describe("hosted (isHosted=true)", () => {
        test("allows empty / nullish (falls back to OpenAI default)", () => {
            expect(validateAiBaseUrl("", { isHosted: true }).ok).toBe(true);
            expect(validateAiBaseUrl(null, { isHosted: true }).ok).toBe(true);
            expect(validateAiBaseUrl(undefined, { isHosted: true }).ok).toBe(
                true,
            );
            // Whitespace-only collapses to empty.
            expect(validateAiBaseUrl("   ", { isHosted: true }).ok).toBe(true);
        });

        test("allows public HTTPS provider URLs", () => {
            const urls = [
                "https://api.openai.com/v1",
                "https://api.groq.com/openai/v1",
                "https://api.together.xyz/v1",
                "https://openrouter.ai/api/v1",
                "https://example.com:8443/v1",
            ];
            for (const u of urls) {
                expect(
                    validateAiBaseUrl(u, { isHosted: true }),
                    `hosted should allow ${u}`,
                ).toEqual({ ok: true });
            }
        });

        test("rejects loopback hostnames with the user-facing message", () => {
            const urls = [
                "http://localhost:1234/v1",
                "http://LOCALHOST/v1",
                "https://localhost",
                // Trailing-dot variant — equivalent to localhost per DNS.
                "http://localhost.:1234/v1",
                // RFC 6761: *.localhost is loopback.
                "http://app.localhost/v1",
                "http://api.localhost:1234/v1",
                "http://127.0.0.1:11434/v1",
                "http://127.1.2.3/v1",
                "http://0.0.0.0:8080/v1",
                "http://[::1]:1234/v1",
                "http://[::]:8080/v1",
                // IPv4-mapped IPv6 routed at loopback. WHATWG normalizes
                // hostname to `[::ffff:7f00:1]` etc.
                "http://[::ffff:127.0.0.1]:1234/v1",
                "http://[::ffff:127.1.2.3]/v1",
            ];
            for (const u of urls) {
                const res = validateAiBaseUrl(u, { isHosted: true });
                expect(res.ok, `hosted should reject ${u}`).toBe(false);
                if (!res.ok) {
                    expect(res.message).toBe(HOSTED_LOCAL_BASE_URL_MESSAGE);
                }
            }
        });

        test("rejects unparseable URLs with a parse-error message", () => {
            const res = validateAiBaseUrl("not a url", { isHosted: true });
            expect(res.ok).toBe(false);
            if (!res.ok) {
                expect(res.message).not.toBe(HOSTED_LOCAL_BASE_URL_MESSAGE);
                expect(res.message).toMatch(/valid absolute URL/i);
            }
        });

        test("does not over-block: hostnames that merely contain 'localhost' or v4-mapped non-loopback", () => {
            // These should pass — they're not loopback.
            const urls = [
                "http://localhostfoo.example.com/v1",
                "http://my-localhost.example.com/v1",
                // IPv4-mapped IPv6 to a public address — not loopback.
                "http://[::ffff:8.8.8.8]/v1",
                // 128.x.x.x is not in 127/8.
                "http://128.0.0.1/v1",
            ];
            for (const u of urls) {
                expect(
                    validateAiBaseUrl(u, { isHosted: true }),
                    `hosted should allow ${u}`,
                ).toEqual({ ok: true });
            }
        });

        test("does NOT block private/container hostnames (out of scope)", () => {
            // We only block loopback/unspecified. Container DNS like
            // `ollama` will fail at request time on hosted infra, which
            // is acceptable — see plan, full SSRF guard is a separate
            // piece tracked under hosted-egress hardening.
            expect(
                validateAiBaseUrl("http://ollama:11434/v1", {
                    isHosted: true,
                }).ok,
            ).toBe(true);
            expect(
                validateAiBaseUrl("http://192.168.1.10/v1", {
                    isHosted: true,
                }).ok,
            ).toBe(true);
        });
    });
});
