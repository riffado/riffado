/**
 * Regression for #268 Greptile P1: a failed optimistic rename A must
 * not wipe a successful rename B. Rollback is scoped to one label and
 * ignored when a newer edit owns that same label.
 */

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeakerNames } from "@/hooks/use-speaker-names";
import {
    nextSpeakerEditGeneration,
    rollbackSpeakerName,
    shouldApplySpeakerEdit,
} from "@/lib/speakers/rename-state";
import type { SpeakerName, SpeakerNameMap } from "@/types/speaker";

vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
    },
}));

type PendingRequest = {
    url: string;
    method: string;
    resolve: (value: Response) => void;
    reject: (reason?: unknown) => void;
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function name(
    speakerLabel: string,
    displayName: string,
    source: SpeakerName["source"] = "manual",
): SpeakerName {
    return {
        speakerLabel,
        displayName,
        source,
        confidence: null,
        voiceProfileId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

let pending: PendingRequest[] = [];

beforeEach(() => {
    pending = [];
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        return new Promise<Response>((resolve, reject) => {
            pending.push({ url, method, resolve, reject });
        });
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function takePending(method: string): PendingRequest {
    const idx = pending.findIndex((p) => p.method === method);
    if (idx < 0) {
        throw new Error(`missing ${method}: ${JSON.stringify(pending)}`);
    }
    const [req] = pending.splice(idx, 1);
    return req;
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe("rollbackSpeakerName", () => {
    const alice = name("SPEAKER_00", "Alice");
    const bob = name("SPEAKER_01", "Bob");
    const map: SpeakerNameMap = {
        SPEAKER_00: alice,
        SPEAKER_01: bob,
    };

    it("restores only the failed label", () => {
        expect(
            rollbackSpeakerName(map, "SPEAKER_00", name("SPEAKER_00", "Old")),
        ).toEqual({
            SPEAKER_00: name("SPEAKER_00", "Old"),
            SPEAKER_01: bob,
        });
    });

    it("drops only the failed label when there was no prior name", () => {
        expect(rollbackSpeakerName(map, "SPEAKER_00", undefined)).toEqual({
            SPEAKER_01: bob,
        });
    });
});

describe("shouldApplySpeakerEdit", () => {
    it("rejects a stale generation after a newer edit of the same label", () => {
        const gens = new Map<string, number>();
        const first = nextSpeakerEditGeneration(gens, "SPEAKER_00");
        const second = nextSpeakerEditGeneration(gens, "SPEAKER_00");
        expect(shouldApplySpeakerEdit(gens, "SPEAKER_00", first)).toBe(false);
        expect(shouldApplySpeakerEdit(gens, "SPEAKER_00", second)).toBe(true);
        expect(shouldApplySpeakerEdit(gens, "SPEAKER_01", 1)).toBe(false);
    });
});

describe("useSpeakerNames overlapping rename rollback", () => {
    it("keeps B when A fails", async () => {
        const hook = renderHook(() => useSpeakerNames("rec-1"));
        await flush();
        takePending("GET").resolve(jsonResponse({ speakers: [] }));
        await flush();

        let renameA!: Promise<void>;
        act(() => {
            renameA = hook.result.current.renameSpeaker("SPEAKER_00", "Alice");
        });
        await flush();
        const putA = takePending("PUT");

        let renameB!: Promise<void>;
        act(() => {
            renameB = hook.result.current.renameSpeaker("SPEAKER_01", "Bob");
        });
        await flush();
        const putB = takePending("PUT");

        putB.resolve(jsonResponse({ speaker: name("SPEAKER_01", "Bob") }));
        await renameB;
        await flush();

        expect(hook.result.current.speakerNames.SPEAKER_01?.displayName).toBe(
            "Bob",
        );

        putA.resolve(jsonResponse({ error: "nope" }, 500));
        await renameA;
        await flush();

        expect(hook.result.current.speakerNames.SPEAKER_00).toBeUndefined();
        expect(hook.result.current.speakerNames.SPEAKER_01?.displayName).toBe(
            "Bob",
        );
        expect(toast.error).toHaveBeenCalledWith("Failed to rename speaker");
    });

    it("does not restore a stale snapshot over a newer edit of the same label", async () => {
        const hook = renderHook(() => useSpeakerNames("rec-1"));
        await flush();
        takePending("GET").resolve(jsonResponse({ speakers: [] }));
        await flush();

        let renameA!: Promise<void>;
        act(() => {
            renameA = hook.result.current.renameSpeaker("SPEAKER_00", "Alice");
        });
        await flush();
        const putA = takePending("PUT");

        let renameB!: Promise<void>;
        act(() => {
            renameB = hook.result.current.renameSpeaker("SPEAKER_00", "Alicia");
        });
        await flush();
        const putB = takePending("PUT");

        putB.resolve(jsonResponse({ speaker: name("SPEAKER_00", "Alicia") }));
        await renameB;
        await flush();

        putA.resolve(jsonResponse({ error: "nope" }, 500));
        await renameA;
        await flush();

        expect(hook.result.current.speakerNames.SPEAKER_00?.displayName).toBe(
            "Alicia",
        );
    });
});
