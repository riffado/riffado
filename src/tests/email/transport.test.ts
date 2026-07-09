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

    it("does not treat a longer tag name as a script/style boundary match", () => {
        const html = `<scriptx>keep me</scriptx><p>Body</p>`;
        const text = htmlToText(html);
        expect(text).toContain("keep me");
        expect(text).toContain("Body");
    });

    it("drops everything after an unclosed script/style tag (no defined end -- conservative by design)", () => {
        const html = `<p>Before</p><script>alert(1)`;
        const text = htmlToText(html);
        expect(text).toBe("Before");
    });

    it("preserves a lone unmatched '<' as literal text instead of truncating the rest of the email", () => {
        // Not an unclosed real tag -- script/style content is already fully
        // removed by this point, so a stray "<" with no ">" anywhere later
        // in the string (ordinary prose: a comparison, a partial tag typed
        // by a user, etc.) must not eat everything after it. Deliberately
        // no later ">" anywhere in the fixture (a "<...>" pair further
        // along would legitimately still get eaten as one bogus tag --
        // that's the same known trade-off the old regex approach had, not
        // what this test is about).
        const html = `<p>Body</p>5 is less than 10, no closing bracket after this`;
        const text = htmlToText(html);
        expect(text).toContain(
            "5 is less than 10, no closing bracket after this",
        );

        const withBareLt = `<p>Body</p>5 < 10, nothing closes after this point`;
        expect(htmlToText(withBareLt)).toContain(
            "5 < 10, nothing closes after this point",
        );
    });

    it("leaves no tag markup behind when an unrelated tag is nested inside what looks like a script tag", () => {
        // "<scr<b>ipt>" is not a real <script> tag; the generic tag stripper
        // consumes from the first "<" to the next ">" regardless of what's
        // nested inside. No "<" can survive (a lone ">" left over from an
        // orphaned close-bracket is inert text, not a tag), so no markup of
        // any kind can be reformed.
        const html = `<scr<b>ipt>alert(1)</scr</b>ipt><p>Body</p>`;
        const text = htmlToText(html);
        expect(text).not.toContain("<");
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
