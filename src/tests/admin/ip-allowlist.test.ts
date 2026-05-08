import { describe, expect, it } from "vitest";
import {
    clientIpFromHeaders,
    ipMatchesAllowlist,
} from "@/lib/admin/ip-allowlist";

describe("ipMatchesAllowlist", () => {
    it("empty list disables the check (true)", () => {
        expect(ipMatchesAllowlist("1.2.3.4", [])).toBe(true);
        expect(ipMatchesAllowlist(null, [])).toBe(true);
    });

    it("non-empty list with no parseable entries fails closed", () => {
        expect(ipMatchesAllowlist("1.2.3.4", ["garbage", "also/bad"])).toBe(
            false,
        );
    });

    it("matches IPv4 host within /24", () => {
        expect(ipMatchesAllowlist("10.0.0.5", ["10.0.0.0/24"])).toBe(true);
        expect(ipMatchesAllowlist("10.0.1.5", ["10.0.0.0/24"])).toBe(false);
    });

    it("bare IPv4 entry treated as /32", () => {
        expect(ipMatchesAllowlist("10.0.0.5", ["10.0.0.5"])).toBe(true);
        expect(ipMatchesAllowlist("10.0.0.6", ["10.0.0.5"])).toBe(false);
    });

    it("strips IPv4-mapped prefix", () => {
        expect(ipMatchesAllowlist("::ffff:10.0.0.5", ["10.0.0.0/24"])).toBe(
            true,
        );
    });

    it("matches IPv6 prefix", () => {
        expect(ipMatchesAllowlist("2001:db8::1", ["2001:db8::/32"])).toBe(true);
        expect(ipMatchesAllowlist("2001:dead::1", ["2001:db8::/32"])).toBe(
            false,
        );
    });

    it("rejects null IP when allowlist is non-empty", () => {
        expect(ipMatchesAllowlist(null, ["10.0.0.0/24"])).toBe(false);
    });

    it("rejects malformed IP", () => {
        expect(ipMatchesAllowlist("not-an-ip", ["10.0.0.0/24"])).toBe(false);
    });

    // Regression guards for cubic review feedback (PR #105) -----------------
    it("rejects entries with empty mask (e.g. '10.0.0.0/') instead of treating as /0", () => {
        // Previously parsed bits=0 and matched everything in IPv4 family.
        expect(ipMatchesAllowlist("203.0.113.5", ["10.0.0.0/"])).toBe(false);
    });

    it("rejects entries with non-digit mask (e.g. '10.0.0.0/abc')", () => {
        expect(ipMatchesAllowlist("10.0.0.5", ["10.0.0.0/abc"])).toBe(false);
    });

    it("rejects entries with multiple slashes", () => {
        expect(ipMatchesAllowlist("10.0.0.5", ["10.0.0.0/24/extra"])).toBe(
            false,
        );
    });

    it("rejects IPv6 addresses with multiple '::' segments", () => {
        // RFC 4291 forbids more than one `::` per address.
        expect(ipMatchesAllowlist("1::2::3", ["::/0"])).toBe(false);
    });
});

describe("clientIpFromHeaders", () => {
    it("prefers x-forwarded-for first entry", () => {
        const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
        expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
    });

    it("falls back to x-real-ip", () => {
        const h = new Headers({ "x-real-ip": "9.9.9.9" });
        expect(clientIpFromHeaders(h)).toBe("9.9.9.9");
    });

    it("returns null when neither header present", () => {
        expect(clientIpFromHeaders(new Headers())).toBe(null);
    });
});
