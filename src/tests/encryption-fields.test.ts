import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

const {
    decryptJsonField,
    decryptText,
    encryptJsonField,
    encryptText,
    isEncryptedJsonField,
    isEncryptedText,
} = await import("../lib/encryption/fields");
const { encrypt } = await import("../lib/encryption");

describe("encryption/fields", () => {
    describe("encryptText / decryptText", () => {
        it("round-trips text and uses the v1 prefix", () => {
            const plaintext = "Hello, transcript world.";
            const ciphertext = encryptText(plaintext);
            expect(ciphertext).toMatch(/^v1:/);
            expect(ciphertext).not.toContain(plaintext);
            expect(decryptText(ciphertext)).toBe(plaintext);
        });

        it("round-trips empty string", () => {
            const c = encryptText("");
            expect(c).toMatch(/^v1:/);
            expect(decryptText(c)).toBe("");
        });

        it("round-trips unicode and large payloads", () => {
            const plaintext = `${"A".repeat(20000)} 日本語 🎉`;
            expect(decryptText(encryptText(plaintext))).toBe(plaintext);
        });

        it("passes null and undefined through both directions", () => {
            expect(encryptText(null)).toBeNull();
            expect(encryptText(undefined)).toBeUndefined();
            expect(decryptText(null)).toBeNull();
            expect(decryptText(undefined)).toBeUndefined();
        });

        it("treats arbitrary plaintext as legacy and returns it verbatim", () => {
            expect(decryptText("plain transcript content")).toBe(
                "plain transcript content",
            );
            expect(decryptText("a:b:c")).toBe("a:b:c");
            expect(decryptText("My Recording 2025-01-01")).toBe(
                "My Recording 2025-01-01",
            );
        });

        it("treats a legacy plaintext that happens to start with 'v1:' as plaintext", () => {
            // Regression for cubic-dev-ai PR #96: a user-typed filename like
            // `v1: rough draft` must not be forwarded into decrypt(). The
            // wrapper requires the full ciphertext shape after the prefix.
            expect(decryptText("v1: rough draft")).toBe("v1: rough draft");
            expect(decryptText("v1:abc")).toBe("v1:abc");
            expect(decryptText("v1:notreallyhex:notreallyhex:0")).toBe(
                "v1:notreallyhex:notreallyhex:0",
            );
            expect(isEncryptedText("v1: rough draft")).toBe(false);
        });

        it("rejects odd-length hex payloads as malformed (treats as plaintext)", () => {
            // Regression for cubic-dev-ai second-pass review on #96: AES-GCM
            // cannot produce an odd-length hex ciphertext (each byte is two
            // hex chars). The wrapper requires `(?:[0-9a-f]{2})*` for the
            // trailing segment, so a malformed value like `...: aaa` is not
            // forwarded to decrypt() — we keep that path as loud as possible
            // for genuine ciphertext.
            const oddV1 = `v1:${"a".repeat(32)}:${"b".repeat(32)}:abc`;
            const oddRaw = `${"a".repeat(32)}:${"b".repeat(32)}:abc`;
            expect(isEncryptedText(oddV1)).toBe(false);
            expect(isEncryptedText(oddRaw)).toBe(false);
            expect(decryptText(oddV1)).toBe(oddV1);
            expect(decryptText(oddRaw)).toBe(oddRaw);
        });

        it("decrypts unversioned ciphertext written by the base encrypt() helper", () => {
            // Simulates a value already in the legacy `iv:tag:ct` shape
            // (the format used historically for Plaud tokens / AI keys).
            // The wrapper should still be able to read it.
            const raw = encrypt("legacy-shaped");
            expect(raw).not.toMatch(/^v1:/);
            expect(decryptText(raw)).toBe("legacy-shaped");
        });

        it("throws on tampered v1 ciphertext (GCM auth)", () => {
            const c = encryptText("secret");
            // Flip a hex digit inside the body; keeps shape valid, breaks tag.
            const tampered = c.replace(/[0-9a-f](?=[0-9a-f]*$)/i, (m) =>
                m === "0" ? "1" : "0",
            );
            expect(tampered).toMatch(/^v1:/);
            expect(() => decryptText(tampered)).toThrow();
        });
    });

    describe("encryptJsonField / decryptJsonField", () => {
        it("round-trips an array (e.g. keyPoints / actionItems)", () => {
            const data = ["key point 1", "key point 2", "🎯"];
            const env = encryptJsonField(data);
            expect(env).toEqual({ c: expect.stringMatching(/^v1:/) });
            expect(decryptJsonField<string[]>(env)).toEqual(data);
        });

        it("round-trips a nested object (e.g. summaryPrompt config)", () => {
            const data = {
                selectedPrompt: "general",
                customPrompts: [{ id: "x", name: "Mine", prompt: "Do X." }],
            };
            const env = encryptJsonField(data);
            expect(decryptJsonField<typeof data>(env)).toEqual(data);
        });

        it("passes null/undefined through both directions", () => {
            expect(encryptJsonField(null)).toBeNull();
            expect(encryptJsonField(undefined)).toBeUndefined();
            expect(decryptJsonField(null)).toBeNull();
            expect(decryptJsonField(undefined)).toBeNull();
        });

        it("returns legacy plaintext jsonb (array) verbatim", () => {
            const legacy = ["one", "two"];
            expect(decryptJsonField<string[]>(legacy)).toEqual(legacy);
        });

        it("returns legacy plaintext jsonb (object) verbatim", () => {
            const legacy = { selectedPrompt: "default", customPrompts: [] };
            expect(decryptJsonField<typeof legacy>(legacy)).toEqual(legacy);
        });

        it("does not confuse a legacy object that happens to have a 'c' string key", () => {
            // A legacy object whose `c` looks like our envelope shape would
            // be ambiguous. We explicitly accept this corner case: an envelope
            // is identified by `{ c: <string> }`. Document the behavior so a
            // future caller does not accidentally store `{ c: "..." }` data.
            const fakeEnvelope = { c: "not actually ciphertext" };
            expect(() => decryptJsonField(fakeEnvelope)).toThrow();
        });
    });

    describe("predicates", () => {
        it("isEncryptedText detects v1 and raw ciphertext shapes", () => {
            expect(isEncryptedText(null)).toBe(false);
            expect(isEncryptedText(undefined)).toBe(false);
            expect(isEncryptedText("plain string")).toBe(false);
            expect(isEncryptedText(encryptText("x"))).toBe(true);
            expect(isEncryptedText(encrypt("y"))).toBe(true);
        });

        it("isEncryptedJsonField detects only the envelope shape", () => {
            expect(isEncryptedJsonField(null)).toBe(false);
            expect(isEncryptedJsonField(["array"])).toBe(false);
            expect(isEncryptedJsonField({ selectedPrompt: "x" })).toBe(false);
            expect(isEncryptedJsonField(encryptJsonField({ a: 1 }))).toBe(true);
        });
    });
});
