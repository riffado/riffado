import { describe, expect, it } from "vitest";
import {
    isReady,
    parseSummary,
    parseTranscript,
    selectContentItems,
} from "@/lib/plaud/content";
import type { PlaudFileDetailResponse } from "@/types/plaud";

// NOTE: these fixtures encode the *hypothesized* /file/detail content shape
// (#204 Phase 0) and MUST be reconciled against a real captured response
// before the import path is trusted in production.

const detail: PlaudFileDetailResponse = {
    status: 0,
    data: {
        id: "f1",
        content_list: [
            {
                data_type: "transaction",
                task_status: 1,
                data_link: "https://s3.example/t.json",
            },
            {
                data_type: "summary",
                task_status: 1,
                data_link: "https://s3.example/s.json",
            },
            { data_type: "mindmap", task_status: 0 },
        ],
    },
};

describe("plaud content parsers", () => {
    it("selects the transcript and summary content items", () => {
        const { transcript, summary } = selectContentItems(detail);
        expect(transcript?.data_type).toBe("transaction");
        expect(summary?.data_type).toBe("summary");
    });

    it("returns nothing for an empty content list", () => {
        expect(selectContentItems({ status: 0, data: {} })).toEqual({});
        expect(selectContentItems({ status: 0 })).toEqual({});
    });

    it("isReady gates on task_status===1 AND a data_link", () => {
        expect(isReady({ task_status: 1, data_link: "x" })).toBe(true);
        expect(isReady({ task_status: 0, data_link: "x" })).toBe(false);
        expect(isReady({ task_status: 1 })).toBe(false);
        expect(isReady(undefined)).toBe(false);
    });

    it("parses a diarized transcript array into speaker-prefixed text", () => {
        const raw = [
            { start_time: 0, speaker: 1, content: "Hello there" },
            { start_time: 5, speaker: 2, content: "Hi back" },
        ];
        const parsed = parseTranscript(raw);
        expect(parsed.text).toBe("Speaker 1: Hello there\nSpeaker 2: Hi back");
        expect(parsed.segments).toHaveLength(2);
    });

    it("handles transcript objects that wrap segments and a language", () => {
        const raw = {
            language: "en",
            segments: [{ speaker: "Alice", content: "Hey" }],
        };
        const parsed = parseTranscript(raw);
        expect(parsed.language).toBe("en");
        expect(parsed.text).toBe("Alice: Hey");
    });

    it("omits a speaker label when the segment has no speaker", () => {
        expect(parseTranscript([{ content: "no speaker" }]).text).toBe(
            "no speaker",
        );
    });

    it("returns empty text for junk transcript input", () => {
        expect(parseTranscript(null).text).toBe("");
        expect(parseTranscript("").text).toBe("");
        expect(parseTranscript(42).segments).toEqual([]);
    });

    it("parses summary from ai_content / summary keys with points + actions", () => {
        expect(parseSummary({ ai_content: "The gist" }).summary).toBe(
            "The gist",
        );
        const s = parseSummary({
            summary: "S",
            key_points: ["a", "b"],
            action_items: ["do x"],
        });
        expect(s.summary).toBe("S");
        expect(s.keyPoints).toEqual(["a", "b"]);
        expect(s.actionItems).toEqual(["do x"]);
    });

    it("treats a bare string as the summary and tolerates junk", () => {
        expect(parseSummary("just text").summary).toBe("just text");
        expect(parseSummary(null)).toEqual({
            summary: "",
            keyPoints: [],
            actionItems: [],
        });
    });
});
