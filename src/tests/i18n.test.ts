import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_PRESETS } from "@/lib/ai/prompt-presets";
import { AI_OUTPUT_LANGUAGES, SUMMARY_PRESETS } from "@/lib/ai/summary-presets";
import { dateGroupLabel, formatDateTime } from "@/lib/format-date";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";
import {
    UI_OUTPUT_LANGUAGES,
    UI_SUMMARY_PRESETS,
    UI_TITLE_PRESETS,
} from "@/lib/i18n/presets";

afterEach(() => vi.useRealTimers());

describe("Chinese UI localization", () => {
    it("falls back safely for upstream additions and prototype property names", () => {
        expect(uiText("Untranslated upstream label")).toBe(
            "Untranslated upstream label",
        );
        expect(uiText("constructor")).toBe("constructor");
        expect(uiText("toString")).toBe("toString");
    });

    it("interpolates values once without interpreting user-owned content", () => {
        expect(uiText("{count} recordings", { count: 3 })).toContain("3");
        expect(uiText("New {name}", { name: "$& {count} <script>" })).toBe(
            "New $& {count} <script>",
        );
        expect(uiText("Missing {value}")).toBe("Missing {value}");
    });

    it("changes preset labels while preserving all AI inputs and identifiers", () => {
        for (const [source, display] of [
            [PROMPT_PRESETS, UI_TITLE_PRESETS],
            [SUMMARY_PRESETS, UI_SUMMARY_PRESETS],
        ] as const) {
            for (const [id, preset] of Object.entries(source)) {
                const localized = Object.values(display).find(
                    (entry) => entry.id === id,
                );
                expect(localized?.id).toBe(preset.id);
                expect(localized?.prompt).toBe(preset.prompt);
                expect(localized?.name).not.toBe(preset.name);
                expect(localized).not.toBe(preset);
            }
        }
        expect(UI_OUTPUT_LANGUAGES.map((entry) => entry.code)).toEqual(
            AI_OUTPUT_LANGUAGES.map((entry) => entry.code),
        );
        expect(
            AI_OUTPUT_LANGUAGES.find((entry) => entry.code === "zh")?.label,
        ).toBe("Chinese (Simplified)");
    });

    it("localizes known errors and retains unknown diagnostics", () => {
        expect(uiError("Unknown upstream details", "PLAUD_OTP_INVALID")).toBe(
            uiText("The verification code is invalid. Please try again."),
        );
        expect(uiError("Custom provider: E42", "UNKNOWN_ERROR")).toBe(
            "Custom provider: E42",
        );
    });

    it("localizes relative dates without changing ISO output or date grouping", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 15, 12));
        const now = new Date();
        expect(dateGroupLabel(now)).toBe("今天");
        expect(dateGroupLabel(new Date(2026, 8, 14, 12))).toBe("昨天");
        expect(formatDateTime(new Date(2026, 8, 15, 11), "relative")).toContain(
            "小时",
        );
        expect(formatDateTime(now, "iso")).toBe(now.toISOString());
    });
});
