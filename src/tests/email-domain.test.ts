import { describe, expect, it } from "vitest";
import { extractEmailDomain, isEmailDomainAllowed } from "../lib/email-domain";

describe("extractEmailDomain", () => {
    it("returns the domain part lower-cased", () => {
        expect(extractEmailDomain("user@Example.COM")).toBe("example.com");
    });

    it("uses the last @ so plus-tagged local parts work", () => {
        expect(extractEmailDomain("foo+bar@aundb.io")).toBe("aundb.io");
    });

    it("returns null for inputs without a real domain", () => {
        expect(extractEmailDomain("noatsign")).toBeNull();
        expect(extractEmailDomain("trailing@")).toBeNull();
        expect(extractEmailDomain("")).toBeNull();
    });
});

describe("isEmailDomainAllowed", () => {
    it("empty allowlist means no restriction", () => {
        expect(isEmailDomainAllowed("anyone@anywhere.tld", [])).toBe(true);
    });

    it("accepts exact-match domains", () => {
        const allowed = ["aepfelbirnen.com", "neosec.eu"];
        expect(isEmailDomainAllowed("ben@aepfelbirnen.com", allowed)).toBe(
            true,
        );
        expect(isEmailDomainAllowed("ben@neosec.eu", allowed)).toBe(true);
    });

    it("rejects domains not in the allowlist", () => {
        const allowed = ["aepfelbirnen.com"];
        expect(isEmailDomainAllowed("attacker@gmail.com", allowed)).toBe(false);
    });

    it("does not auto-allow subdomains", () => {
        // Exact match is the safer default: an operator who genuinely
        // wants to admit mail.aepfelbirnen.com must add it explicitly.
        const allowed = ["aepfelbirnen.com"];
        expect(isEmailDomainAllowed("x@mail.aepfelbirnen.com", allowed)).toBe(
            false,
        );
    });

    it("is case-insensitive on both sides", () => {
        expect(
            isEmailDomainAllowed("User@AEPFELBIRNEN.com", ["aepfelbirnen.com"]),
        ).toBe(true);
    });

    it("rejects inputs that do not parse as email", () => {
        expect(isEmailDomainAllowed("noatsign", ["aepfelbirnen.com"])).toBe(
            false,
        );
        expect(isEmailDomainAllowed("", ["aepfelbirnen.com"])).toBe(false);
    });
});
