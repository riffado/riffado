import { describe, expect, it } from "vitest";
import { stripReasoning } from "@/lib/ai/chat-completion-params";

describe("stripReasoning", () => {
    it("returns plain answers unchanged, trimmed", () => {
        expect(stripReasoning("  Weekly planning call \n")).toBe(
            "Weekly planning call",
        );
    });

    it("removes inline reasoning blocks", () => {
        expect(
            stripReasoning(
                "<think>\nThe user wants a title.\n</think>\n\nBudget review",
            ),
        ).toBe("Budget review");
        expect(
            stripReasoning("<THINKING>a</THINKING>One<think>b</think> two"),
        ).toBe("One two");
    });

    it("drops an unclosed reasoning block (budget ran out)", () => {
        expect(stripReasoning("<think>Let me consider the transcript")).toBe(
            "",
        );
        expect(stripReasoning("Answer <think>trailing")).toBe("Answer");
    });

    it("returns an empty string for missing content", () => {
        expect(stripReasoning(null)).toBe("");
        expect(stripReasoning(undefined)).toBe("");
    });
});
