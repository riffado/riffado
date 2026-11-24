/**
 * @vitest-environment jsdom
 *
 * `/api/plaud/sync` answers HTTP 200 with an `errors` array when a sync
 * fails. The client must treat that as a failure: no "Synced just now",
 * no "Sync complete" toast, and the last successful time stays put.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { useAutoSync } from "@/hooks/use-auto-sync";

function mockSyncResponse(body: Record<string, unknown>) {
    vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }),
    );
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("useAutoSync with a failed sync", () => {
    it("reports the first error and keeps the last sync time", async () => {
        mockSyncResponse({
            success: true,
            newRecordings: 0,
            errors: ["Sync failed: upstream timeout"],
            needsReconnect: false,
        });
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const { result } = renderHook(() =>
            useAutoSync({ enabled: false, onSuccess, onError }),
        );

        await act(async () => {
            await result.current.manualSync();
        });

        expect(result.current.lastSyncResult).toMatchObject({
            success: false,
            error: "Sync failed: upstream timeout",
        });
        expect(result.current.lastSyncTime).toBeNull();
        expect(localStorage.getItem("riffado_last_sync")).toBeNull();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("Sync failed: upstream timeout");
    });

    it("leaves a rejected token to the reconnect banner", async () => {
        mockSyncResponse({
            success: true,
            newRecordings: 0,
            errors: [
                "Plaud rejected the stored token. Reconnect your Plaud account.",
            ],
            needsReconnect: true,
        });
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const { result } = renderHook(() =>
            useAutoSync({ enabled: false, onSuccess, onError }),
        );

        await act(async () => {
            await result.current.manualSync();
        });

        expect(result.current.lastSyncResult).toMatchObject({
            success: false,
            needsReconnect: true,
        });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it("still records a clean sync as a success", async () => {
        mockSyncResponse({
            success: true,
            newRecordings: 2,
            errors: [],
            needsReconnect: false,
        });
        const onSuccess = vi.fn();
        const { result } = renderHook(() =>
            useAutoSync({ enabled: false, onSuccess }),
        );

        await act(async () => {
            await result.current.manualSync();
        });

        expect(result.current.lastSyncResult).toMatchObject({
            success: true,
            newRecordings: 2,
        });
        expect(result.current.lastSyncTime).not.toBeNull();
        expect(onSuccess).toHaveBeenCalledWith(2);
    });
});
