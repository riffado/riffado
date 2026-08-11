import { Folder, Mountain, Music, UsersRound } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_FILETAG_COLOR,
    DEFAULT_FILETAG_ICON,
    denormalizeFiletagIcon,
    getFiletagIcon,
    LEGACY_CODEPOINT_MAP,
    normalizeFiletagIcon,
    PLAUD_FILETAG_COLORS,
    PLAUD_FILETAG_ICON_MAP,
} from "@/lib/plaud/filetag-icons";

describe("normalizeFiletagIcon", () => {
    it("passes canonical Plaud icon names through unchanged", () => {
        expect(normalizeFiletagIcon("iconfont_folder_meeting")).toBe(
            "iconfont_folder_meeting",
        );
        expect(normalizeFiletagIcon("iconfont_folder_foler_1")).toBe(
            "iconfont_folder_foler_1",
        );
        expect(normalizeFiletagIcon("iconfont_a_folder_tasklist")).toBe(
            "iconfont_a_folder_tasklist",
        );
    });

    it("maps legacy codepoints to canonical names", () => {
        expect(normalizeFiletagIcon("e627")).toBe("iconfont_folder_foler_1");
        expect(normalizeFiletagIcon("e607")).toBe("iconfont_folder_meeting");
        // Second/third font generation codepoints resolve too.
        expect(normalizeFiletagIcon("e649")).toBe("iconfont_folder_meeting");
    });

    it("is case-insensitive for codepoints", () => {
        expect(normalizeFiletagIcon("E627")).toBe("iconfont_folder_foler_1");
    });

    it("falls back to the default icon for garbage and empty values", () => {
        expect(normalizeFiletagIcon("not-an-icon")).toBe(DEFAULT_FILETAG_ICON);
        expect(normalizeFiletagIcon("")).toBe(DEFAULT_FILETAG_ICON);
        expect(normalizeFiletagIcon(null)).toBe(DEFAULT_FILETAG_ICON);
        expect(normalizeFiletagIcon(undefined)).toBe(DEFAULT_FILETAG_ICON);
    });

    it("trims whitespace before matching", () => {
        expect(normalizeFiletagIcon("  iconfont_folder_music  ")).toBe(
            "iconfont_folder_music",
        );
    });

    it("every legacy codepoint resolves to a mappable canonical name", () => {
        for (const name of Object.values(LEGACY_CODEPOINT_MAP)) {
            expect(PLAUD_FILETAG_ICON_MAP[name]).toBeDefined();
        }
    });
});

describe("denormalizeFiletagIcon", () => {
    it("maps canonical names to first-generation wire codepoints", () => {
        expect(denormalizeFiletagIcon("iconfont_folder_foler_1")).toBe("e627");
        expect(denormalizeFiletagIcon("iconfont_folder_meeting")).toBe("e607");
        expect(denormalizeFiletagIcon("iconfont_folder_home")).toBe("e619");
    });

    it("falls back to the default folder codepoint for unknown or missing names", () => {
        expect(denormalizeFiletagIcon("not-an-icon")).toBe("e627");
        expect(denormalizeFiletagIcon(null)).toBe("e627");
        expect(denormalizeFiletagIcon(undefined)).toBe("e627");
    });

    it("round-trips every canonical name through the wire format", () => {
        for (const name of Object.keys(PLAUD_FILETAG_ICON_MAP)) {
            expect(normalizeFiletagIcon(denormalizeFiletagIcon(name))).toBe(
                name,
            );
        }
    });
});

describe("getFiletagIcon", () => {
    it("resolves mapped names to their lucide components", () => {
        expect(getFiletagIcon("iconfont_folder_music")).toBe(Music);
        // Glyph-checked against the official web bundle: `ground` is a
        // group of people and `view` is the mountain panorama.
        expect(getFiletagIcon("iconfont_folder_ground")).toBe(UsersRound);
        expect(getFiletagIcon("iconfont_folder_view")).toBe(Mountain);
    });

    it("falls back to Folder for unknown or missing names", () => {
        expect(getFiletagIcon("e627")).toBe(Folder); // raw codepoints are normalized at persist time
        expect(getFiletagIcon("unknown")).toBe(Folder);
        expect(getFiletagIcon(null)).toBe(Folder);
        expect(getFiletagIcon(undefined)).toBe(Folder);
    });
});

describe("palette", () => {
    it("matches the official 7-color palette with the dark default", () => {
        expect(PLAUD_FILETAG_COLORS).toHaveLength(7);
        expect(PLAUD_FILETAG_COLORS).toContain(DEFAULT_FILETAG_COLOR);
        expect(DEFAULT_FILETAG_COLOR).toBe("#191919");
    });
});
