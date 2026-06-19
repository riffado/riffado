/**
 * Pins `parseSummaryResponse`, the LLM-output parser for the summary
 * route. The load-bearing case is issue #199: a custom summary prompt
 * can make the model return JSON whose `summary` is a nested object
 * (or a different shape entirely). Before the fix, that object flowed
 * straight into `encryptText` and threw:
 *
 *   Encryption failed: The "data" argument must be of type string ...
 *   Received an instance of Object
 *
 * surfacing as an opaque 500 with no summary stored. The parser must
 * always return a string `summary` and string[] for the two arrays.
 */

import { describe, expect, it } from "vitest";
import { parseSummaryResponse } from "@/lib/ai/summary-response";

describe("parseSummaryResponse", () => {
    it("parses the well-formed preset shape", () => {
        const raw = JSON.stringify({
            summary: "A concise summary.",
            keyPoints: ["point one", "point two"],
            actionItems: ["do the thing"],
        });
        expect(parseSummaryResponse(raw)).toEqual({
            summary: "A concise summary.",
            keyPoints: ["point one", "point two"],
            actionItems: ["do the thing"],
        });
    });

    it("strips ```json fences before parsing", () => {
        const raw =
            '```json\n{"summary":"fenced","keyPoints":[],"actionItems":[]}\n```';
        expect(parseSummaryResponse(raw).summary).toBe("fenced");
    });

    it("never returns an object summary (issue #199 crash case)", () => {
        // A custom prompt that asks the model to 'format by recording
        // type' can yield a nested object for `summary`.
        const raw = JSON.stringify({
            summary: { meeting: { attendees: ["A", "B"], decisions: [] } },
            keyPoints: ["k"],
            actionItems: [],
        });
        const result = parseSummaryResponse(raw);
        // The non-string summary must never reach encryptText; with usable
        // points present we keep an empty summary and surface the points,
        // rather than dumping the raw JSON blob as the summary text.
        expect(typeof result.summary).toBe("string");
        expect(result.summary).toBe("");
        expect(result.keyPoints).toEqual(["k"]);
    });

    it("falls back to raw text when JSON has no usable content at all", () => {
        // Non-string summary AND no points -> nothing usable, so show the
        // raw model output instead of a blank summary.
        const raw = JSON.stringify({
            summary: { nested: "object" },
            keyPoints: [],
            actionItems: [],
        });
        const result = parseSummaryResponse(raw);
        expect(result.summary).toBe(raw);
    });

    it("keeps a deliberately empty summary when points are present", () => {
        // A 'bullet points only' custom prompt may return summary:"" with
        // populated keyPoints — that empty summary must be preserved, not
        // replaced by the raw JSON.
        const raw = JSON.stringify({
            summary: "",
            keyPoints: ["a", "b"],
            actionItems: [],
        });
        const result = parseSummaryResponse(raw);
        expect(result.summary).toBe("");
        expect(result.keyPoints).toEqual(["a", "b"]);
    });

    it("coerces non-string array elements to strings", () => {
        const raw = JSON.stringify({
            summary: "ok",
            keyPoints: [{ point: "nested" }, "plain"],
            actionItems: [42],
        });
        const result = parseSummaryResponse(raw);
        expect(result.keyPoints).toEqual(['{"point":"nested"}', "plain"]);
        expect(result.actionItems).toEqual(["42"]);
        expect(result.keyPoints.every((p) => typeof p === "string")).toBe(true);
    });

    it("treats non-JSON output as the summary text", () => {
        const raw = "Just a plain prose summary, no JSON at all.";
        expect(parseSummaryResponse(raw)).toEqual({
            summary: "Just a plain prose summary, no JSON at all.",
            keyPoints: [],
            actionItems: [],
        });
    });

    it("omits the summary key but keeps points -> empty summary, points surfaced", () => {
        const raw = JSON.stringify({ keyPoints: ["only points"] });
        const result = parseSummaryResponse(raw);
        expect(result.summary).toBe("");
        expect(result.keyPoints).toEqual(["only points"]);
    });

    it("defaults missing arrays to empty", () => {
        const raw = JSON.stringify({ summary: "just a summary" });
        expect(parseSummaryResponse(raw)).toEqual({
            summary: "just a summary",
            keyPoints: [],
            actionItems: [],
        });
    });

    it("handles a non-string array (non-array keyPoints) gracefully", () => {
        const raw = JSON.stringify({
            summary: "s",
            keyPoints: "not an array",
            actionItems: null,
        });
        expect(parseSummaryResponse(raw)).toEqual({
            summary: "s",
            keyPoints: [],
            actionItems: [],
        });
    });
});
