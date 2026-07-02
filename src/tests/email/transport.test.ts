import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {},
}));
vi.mock("@/lib/smtp", () => ({
    isSmtpConfigured: () => false,
}));

import { htmlToText } from "@/lib/email/transport";

describe("htmlToText", () => {
    it("strips tags and decodes common entities", () => {
        const html = `
            <p>Hello &amp; welcome to <strong>Riffado</strong>.</p>
            <p>Visit at <a href="https://riffado.com/docs">riffado.com/docs</a>.</p>
        `;
        const text = htmlToText(html);
        expect(text).toContain("Hello & welcome to Riffado.");
        expect(text).toContain("Visit at riffado.com/docs.");
        // Tags should be gone (decoded entities like `<` from `&lt;`
        // are allowed and intentional -- see the next test).
        expect(text).not.toMatch(/<\w+>/);
        expect(text).not.toMatch(/<\/\w+>/);
    });

    it("decodes &lt; and &gt; entities to literal angle brackets", () => {
        const html = `<p>Compare &lt;before&gt; and &lt;after&gt;.</p>`;
        const text = htmlToText(html);
        expect(text).toContain("<before>");
        expect(text).toContain("<after>");
    });

    it("removes script and style blocks entirely (no inline JS/CSS leaks into plain text)", () => {
        const html = `<style>body { color: red; }</style><p>Body</p><script>alert(1)</script>`;
        const text = htmlToText(html);
        expect(text).toBe("Body");
    });

    it("removes script/style blocks whose closing tag has whitespace or attributes before '>'", () => {
        const html = `<style>body{color:red}</style ><p>Body</p><script>alert(1)</script\t\nfoo="bar">`;
        const text = htmlToText(html);
        expect(text).toBe("Body");
    });

    it("removes overlapping/nested script tags a single pass would miss", () => {
        const html = `<scr<script>ipt>alert(1)</scr</script>ipt><p>Body</p>`;
        const text = htmlToText(html);
        expect(text).not.toContain("alert(1)");
        expect(text).toContain("Body");
    });

    it("collapses whitespace runs but preserves paragraph breaks", () => {
        const html = `<p>One</p>\n\n\n\n<p>Two</p>`;
        const text = htmlToText(html);
        expect(text).toContain("One");
        expect(text).toContain("Two");
        expect(text).not.toMatch(/\n\n\n/);
    });
});
