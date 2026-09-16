/**
 * Regression for #265: Plaud markdown summaries and SPEAKER-labeled
 * transcript turns render as React trees in the transcription panel.
 * Non-diarized text stays pre-wrapped; href/src stay on the allowlist.
 */

// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
    RichMarkdown,
    SpeakerTranscript,
} from "@/components/recordings/rich-content";

describe("RichMarkdown (#265)", () => {
    it("renders Plaud headings, emphasis, lists, quotes, and rules", () => {
        const { container } = render(
            createElement(RichMarkdown, {
                content: [
                    "# Meeting Summary",
                    "",
                    "This is **bold** and *italic* and ~~old~~ and `code`.",
                    "",
                    "- first",
                    "- second",
                    "",
                    "1. alpha",
                    "2. beta",
                    "",
                    "- [x] done",
                    "- [ ] later",
                    "",
                    "> quoted",
                    "",
                    "---",
                ].join("\n"),
            }),
        );

        expect(container.querySelector("h1")?.textContent).toBe(
            "Meeting Summary",
        );
        expect(container.querySelector("strong")?.textContent).toBe("bold");
        expect(container.querySelector("em")?.textContent).toBe("italic");
        expect(container.querySelector("del")?.textContent).toBe("old");
        expect(container.querySelector("code")?.textContent).toBe("code");
        expect(
            [...container.querySelectorAll("ul > li")].map((li) =>
                li.textContent?.trim(),
            ),
        ).toEqual(["first", "second", "done", "later"]);
        const olItems = [...container.querySelectorAll("ol > li")];
        expect(olItems.map((li) => li.textContent?.trim())).toEqual([
            "alpha",
            "beta",
        ]);
        expect(container.querySelector("ol")?.className).toContain(
            "list-decimal",
        );
        for (const li of olItems) {
            expect(li.className).not.toContain("flex");
        }
        expect(
            container.querySelectorAll('input[type="checkbox"]'),
        ).toHaveLength(2);
        expect(
            (
                container.querySelector(
                    'input[type="checkbox"]',
                ) as HTMLInputElement
            ).checked,
        ).toBe(true);
        expect(container.querySelector("blockquote")?.textContent).toBe(
            "quoted",
        );
        expect(container.querySelector("hr")).not.toBeNull();
    });

    it("allowlists https and same-origin hrefs and rejects the rest", () => {
        const { container } = render(
            createElement(RichMarkdown, {
                content: [
                    "[ok](https://example.com/a)",
                    "[path](/settings)",
                    "[proto](//evil.example/x)",
                    "[slash](/\\\\evil.example/x)",
                    "[js](javascript:alert(1))",
                    "[data](data:text/html,hi)",
                    "[http](http://example.com/a)",
                ].join("\n"),
            }),
        );

        const hrefs = [...container.querySelectorAll("a")].map((a) =>
            a.getAttribute("href"),
        );
        expect(hrefs).toEqual(["https://example.com/a", "/settings"]);
        expect(container.textContent).toContain("proto");
        expect(container.textContent).toContain("js");
        expect(container.textContent).toContain("data");
        expect(container.textContent).toContain("http");
    });

    it("allowlists image srcs and leaves unsafe images as text", () => {
        const { container } = render(
            createElement(RichMarkdown, {
                content: [
                    "![safe](https://cdn.example/img.png)",
                    "![asset](/api/plaud-assets/x.png)",
                    "![js](javascript:alert(1))",
                    "![data](data:image/png;base64,aaaa)",
                    "![proto](//evil.example/x.png)",
                ].join("\n"),
            }),
        );

        const srcs = [...container.querySelectorAll("img")].map((img) =>
            img.getAttribute("src"),
        );
        expect(srcs).toEqual([
            "https://cdn.example/img.png",
            "/api/plaud-assets/x.png",
        ]);
        const hrefs = [...container.querySelectorAll("a")].map((a) =>
            a.getAttribute("href"),
        );
        expect(hrefs).toEqual([]);
        expect(srcs.some((src) => src?.startsWith("javascript:"))).toBe(false);
        expect(srcs.some((src) => src?.startsWith("data:"))).toBe(false);
        expect(srcs.some((src) => src?.startsWith("//"))).toBe(false);
    });

    it("escapes HTML instead of injecting it", () => {
        const { container } = render(
            createElement(RichMarkdown, {
                content: '<script>alert("xss")</script>',
            }),
        );
        expect(container.querySelector("script")).toBeNull();
        expect(container.innerHTML).not.toContain("dangerouslySetInnerHTML");
        expect(container.textContent).toContain(
            '<script>alert("xss")</script>',
        );
    });
});

describe("SpeakerTranscript (#265)", () => {
    it("groups SPEAKER, Speaker n, and UNKNOWN turns", () => {
        const { container } = render(
            createElement(SpeakerTranscript, {
                text: [
                    "SPEAKER_00: hello",
                    "Speaker 1: there",
                    "UNKNOWN: who",
                    "SPEAKER_00: again",
                ].join("\n"),
            }),
        );

        const turns = [...container.querySelectorAll(":scope > div > div")];
        expect(turns).toHaveLength(4);
        expect(turns[0].querySelector("span")?.textContent).toBe("SPEAKER_00:");
        expect(turns[1].querySelector("span")?.textContent).toBe("Speaker 1:");
        expect(turns[2].querySelector("span")?.textContent).toBe("UNKNOWN:");
        expect(turns[0].textContent).toContain("hello");
        expect(turns[3].textContent).toContain("again");
        expect(turns[0].querySelector("span")?.className).toContain(
            "text-accent-cyan",
        );
        expect(turns[3].querySelector("span")?.className).toContain(
            "text-accent-cyan",
        );
        expect(turns[1].querySelector("span")?.className).toContain(
            "text-emerald-400",
        );
    });

    it("keeps non-diarized transcripts pre-wrapped", () => {
        const text = "Question: what now?\nAction item: ship it\nJust prose.";
        const { container } = render(
            createElement(SpeakerTranscript, { text }),
        );
        const p = container.querySelector("p");
        expect(p).not.toBeNull();
        expect(p?.className).toContain("whitespace-pre-wrap");
        expect(p?.textContent).toBe(text);
        expect(container.querySelectorAll(":scope > div > div")).toHaveLength(
            0,
        );
    });
});
