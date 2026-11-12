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
            stripReasoning("<THINKING>a</THINKING><think>b</think> Answer"),
        ).toBe("Answer");
    });

    it("drops an unclosed reasoning block (budget ran out)", () => {
        expect(stripReasoning("<think>Let me consider the transcript")).toBe(
            "",
        );
        expect(stripReasoning("<think>a</think><think>budget ran out")).toBe(
            "",
        );
    });

    it("drops reasoning before a closing tag with no opening tag", () => {
        expect(
            stripReasoning("The user wants a title.\n</think>\nBudget review"),
        ).toBe("Budget review");
        expect(stripReasoning("only reasoning</think>")).toBe("");
        expect(stripReasoning("a</THINKING> b </think> Answer")).toBe("Answer");
    });

    it("handles a nested block", () => {
        expect(stripReasoning("<think>a<think>b</think>c</think>Answer")).toBe(
            "Answer",
        );
    });

    it("keeps tag text in the middle of an answer", () => {
        const json = JSON.stringify({
            summary: "Speaker explained the <think> tag and </think> too",
        });
        expect(stripReasoning(json)).toBe(json);
        expect(stripReasoning("Answer <think>aside")).toBe(
            "Answer <think>aside",
        );
        expect(stripReasoning("One<think>b</think> two")).toBe(
            "One<think>b</think> two",
        );
    });

    it("returns an empty string for missing content", () => {
        expect(stripReasoning(null)).toBe("");
        expect(stripReasoning(undefined)).toBe("");
    });
});
