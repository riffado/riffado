/**
 * Pins the server-side scaffolding that makes custom summary prompts
 * (issue #199) seamless: the user writes intent only, while Riffado
 * guarantees (a) the transcript reaches the model and (b) the output
 * shape is specified — neither of which the user must encode by hand.
 */

import { describe, expect, it } from "vitest";
import {
    buildSummarySystemMessage,
    buildSummaryUserPrompt,
    SUMMARY_OUTPUT_CONTRACT,
} from "@/lib/ai/summary-prompt";

describe("buildSummaryUserPrompt", () => {
    it("substitutes the {transcription} placeholder", () => {
        const out = buildSummaryUserPrompt(
            "Summarize this: {transcription}",
            "hello world",
        );
        expect(out).toBe("Summarize this: hello world");
    });

    it("substitutes every occurrence of the placeholder", () => {
        const out = buildSummaryUserPrompt(
            "{transcription} ... and again: {transcription}",
            "X",
        );
        expect(out).toBe("X ... and again: X");
    });

    it("appends the transcript when the prompt omits the placeholder", () => {
        // The seamless case: a custom prompt that never mentions
        // {transcription} must still receive the transcript.
        const out = buildSummaryUserPrompt(
            "Give me the gist, in three sentences.",
            "the transcript body",
        );
        expect(out).toContain("Give me the gist, in three sentences.");
        expect(out).toContain("the transcript body");
        expect(out.endsWith("the transcript body")).toBe(true);
    });

    it("does not re-scan inserted transcript text for further placeholders", () => {
        const out = buildSummaryUserPrompt(
            "{transcription}",
            "literally {transcription}",
        );
        expect(out).toBe("literally {transcription}");
    });
});

describe("buildSummarySystemMessage", () => {
    it("always states the JSON output contract", () => {
        const msg = buildSummarySystemMessage();
        expect(msg).toContain(SUMMARY_OUTPUT_CONTRACT);
        // The three stored keys must be named so a custom prompt need not.
        expect(msg).toContain('"summary"');
        expect(msg).toContain('"keyPoints"');
        expect(msg).toContain('"actionItems"');
    });

    it("appends the language directive when provided", () => {
        const directive = "IMPORTANT: Write all output in Czech.";
        const msg = buildSummarySystemMessage(directive);
        expect(msg).toContain(directive);
        expect(msg).toContain(SUMMARY_OUTPUT_CONTRACT);
    });

    it("omits the language directive when null/empty", () => {
        const msg = buildSummarySystemMessage(null);
        expect(msg).not.toContain("IMPORTANT: Write all output");
    });
});
