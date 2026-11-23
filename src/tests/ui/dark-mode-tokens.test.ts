import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Index of the brace that closes the block opened at `open`. */
function closingBrace(source: string, open: number): number {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error("Unbalanced braces in globals.css");
}

/** Brace depth at `index`: 0 means a top-level, unlayered rule. */
function depthAt(source: string, index: number): number {
    let depth = 0;
    for (let i = 0; i < index; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
    }
    return depth;
}

/** Custom properties declared directly in the top-level block `selector {`. */
function tokens(selector: string): Map<string, string> {
    const start = css.search(new RegExp(`^${selector} \\{`, "m"));
    if (start === -1) throw new Error(`No ${selector} block`);
    const open = css.indexOf("{", start);
    const body = css
        .slice(open + 1, closingBrace(css, open))
        .replace(/\/\*[\s\S]*?\*\//g, "");
    const map = new Map<string, string>();
    for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        map.set(match[1], match[2].replace(/\s+/g, " ").trim());
    }
    return map;
}

const light = tokens(":root");
const darkOnly = tokens("\\.dark");
const dark = new Map([...light, ...darkOnly]);

/** Follows `var(--x)` references until a hex colour. */
function hex(map: Map<string, string>, name: string): string {
    let value = map.get(name);
    for (let hops = 0; value?.startsWith("var("); hops++) {
        if (hops > 10) throw new Error(`Reference loop at ${name}`);
        value = map.get(value.slice(4, -1).trim());
    }
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`${name} is not a hex colour: ${value}`);
    }
    return value.toLowerCase();
}

function luminance(color: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = Number.parseInt(color.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe("dark mode tokens (DESIGN.md section 3, Paper page 08)", () => {
    it("maps surfaces, text and status to the Paper dark palette", () => {
        expect(hex(dark, "--sidebar")).toBe("#1f1e1d");
        expect(hex(dark, "--background")).toBe("#262624");
        expect(hex(dark, "--reader")).toBe("#262624");
        expect(hex(dark, "--card")).toBe("#30302e");
        expect(hex(dark, "--menu-surface")).toBe("#30302e");
        expect(hex(dark, "--dialog-surface")).toBe("#30302e");
        expect(hex(dark, "--player-surface")).toBe("#30302e");
        expect(hex(dark, "--accent")).toBe("#30302e");
        expect(hex(dark, "--border")).toBe("#3e3e38");
        expect(hex(dark, "--hairline")).toBe("#3e3e38");
        expect(hex(dark, "--strong")).toBe("#faf9f5");
        expect(hex(dark, "--foreground")).toBe("#c3c0b6");
        expect(hex(dark, "--muted-foreground")).toBe("#a3a196");
        expect(hex(dark, "--status-ready")).toBe("#3fcf5c");
        expect(hex(dark, "--status-working")).toBe("#e8b931");
        expect(hex(dark, "--terracotta")).toBe("#d97757");
        expect(hex(dark, "--terracotta-wash")).toBe("#34271f");
        expect(hex(dark, "--row-selected")).toBe("#1a1915");
    });

    it("keeps muted and body text at 4.5:1 on every dark surface", () => {
        const surfaces = [
            "--background",
            "--card",
            "--sidebar",
            "--row-selected",
            "--dialog-footer",
        ];
        for (const text of ["--muted-foreground", "--foreground", "--strong"]) {
            for (const surface of surfaces) {
                expect(
                    contrast(hex(dark, text), hex(dark, surface)),
                    `${text} on ${surface}`,
                ).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it("draws the success toast glyph in ink at 3:1 or more in both modes", () => {
        for (const mode of [light, dark]) {
            expect(
                contrast(hex(mode, "--ink"), hex(mode, "--status-ready")),
            ).toBeGreaterThanOrEqual(3);
        }
    });

    it("adds roles in light as aliases, so light mode renders the same", () => {
        expect(light.get("--field-surface")).toBe("var(--reader)");
        expect(light.get("--row-selected")).toBe("var(--accent)");
        expect(light.get("--dialog-footer")).toBe("var(--surface)");
        expect(light.get("--quiet-surface")).toBe("var(--surface)");
    });

    it("styles ding toasts outside any layer, so they beat its own sheet", () => {
        const at = css.indexOf(".tst-viewport {");
        expect(at).toBeGreaterThan(-1);
        expect(depthAt(css, at)).toBe(0);
    });
});
