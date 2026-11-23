/**
 * @vitest-environment jsdom
 *
 * Upload handoff: the placeholder row stays until its recording is in
 * the list (no frame without either row), and it is paired with the new
 * recording by stored filename against the ids present when it finished.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import type { PendingUpload } from "@/components/dashboard/pending-upload-row";
import {
    matchUploadedRecordings,
    useUploadQueue,
} from "@/hooks/use-upload-queue";

function upload(overrides: Partial<PendingUpload>): PendingUpload {
    return {
        id: "pending:1",
        filename: "memo.m4a",
        filesize: 10,
        startedAt: 0,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("matchUploadedRecordings", () => {
    it("pairs an upload with the new recording of the same name", () => {
        const matches = matchUploadedRecordings(
            [upload({ uploadedAs: "memo" })],
            new Map([["pending:1", new Set(["old"])]]),
            [
                { id: "old", filename: "memo" },
                { id: "new", filename: "memo" },
            ],
        );
        expect(matches.get("pending:1")?.id).toBe("new");
    });

    it("waits while the upload is in flight or the recording hasn't arrived", () => {
        const recordings = [{ id: "old", filename: "memo" }];
        expect(
            matchUploadedRecordings(
                [upload({})],
                new Map([["pending:1", new Set<string>()]]),
                recordings,
            ).size,
        ).toBe(0);
        expect(
            matchUploadedRecordings(
                [upload({ uploadedAs: "memo" })],
                new Map([["pending:1", new Set(["old"])]]),
                recordings,
            ).size,
        ).toBe(0);
    });

    it("gives two uploads with the same name different recordings", () => {
        const known = new Set<string>();
        const matches = matchUploadedRecordings(
            [
                upload({ id: "pending:1", uploadedAs: "memo" }),
                upload({ id: "pending:2", uploadedAs: "memo" }),
            ],
            new Map([
                ["pending:1", known],
                ["pending:2", known],
            ]),
            [
                { id: "a", filename: "memo" },
                { id: "b", filename: "memo" },
            ],
        );
        expect(matches.get("pending:1")?.id).toBe("a");
        expect(matches.get("pending:2")?.id).toBe("b");
    });
});

describe("useUploadQueue", () => {
    it("keeps the placeholder after success until it is settled", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json({ success: true, filename: "memo" }),
            ),
        );
        const onUploadComplete = vi.fn();
        const onBeforeListChange = vi.fn();
        const { result } = renderHook(() =>
            useUploadQueue({ onUploadComplete, onBeforeListChange }),
        );

        await act(async () => {
            await result.current.uploadFile(
                new File(["x"], "memo.m4a", { type: "audio/mp4" }),
            );
        });

        expect(result.current.pendingUploads).toHaveLength(1);
        const [pending] = result.current.pendingUploads;
        expect(pending.uploadedAs).toBe("memo");
        expect(onUploadComplete).toHaveBeenCalledWith(pending);
        expect(onBeforeListChange).toHaveBeenCalledTimes(2);

        act(() => result.current.settleUpload(pending.id));
        expect(result.current.pendingUploads).toHaveLength(0);
    });

    it("drops the placeholder when the upload fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json({ error: "Nope" }, { status: 500 }),
            ),
        );
        const onUploadComplete = vi.fn();
        const { result } = renderHook(() =>
            useUploadQueue({ onUploadComplete }),
        );

        await act(async () => {
            await result.current.uploadFile(
                new File(["x"], "memo.m4a", { type: "audio/mp4" }),
            );
        });

        expect(result.current.pendingUploads).toHaveLength(0);
        expect(onUploadComplete).not.toHaveBeenCalled();
    });
});
