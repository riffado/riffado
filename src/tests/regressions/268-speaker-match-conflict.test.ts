/**
 * Regression for #268 Greptile P1: an absent-row speaker match that
 * races a concurrent manual rename must classify the new row as skipped
 * (manual wins) instead of aborting the match batch.
 */

import { describe, expect, it } from "vitest";
import {
    classifyConflictSpeaker,
    isUniqueViolation,
} from "@/lib/speakers/match-write";

describe("isUniqueViolation", () => {
    it("recognizes Postgres 23505 on the error or its cause", () => {
        expect(isUniqueViolation({ code: "23505" })).toBe(true);
        expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
        expect(isUniqueViolation(new Error("duplicate key"))).toBe(false);
    });
});

describe("classifyConflictSpeaker", () => {
    it("skips a concurrent manual row", () => {
        expect(
            classifyConflictSpeaker({
                id: "sn-1",
                source: "manual",
                displayName: "Alice",
            }),
        ).toEqual({ action: "skip", displayName: "Alice" });
    });

    it("retries a guarded update when the winner is not manual", () => {
        expect(
            classifyConflictSpeaker({
                id: "sn-2",
                source: "auto",
                displayName: "Alice",
            }),
        ).toEqual({
            action: "update",
            id: "sn-2",
            displayName: "Alice",
        });
    });

    it("ignores a vanished row", () => {
        expect(classifyConflictSpeaker(undefined)).toEqual({ action: "none" });
    });
});
