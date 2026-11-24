import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: { IS_HOSTED: true },
}));

vi.mock("@/db", () => ({
    db: { select: vi.fn() },
}));

vi.mock("@/lib/hosted/transcription/mynah", () => ({
    isMynahConfigured: vi.fn(),
}));

vi.mock("@/lib/entitlements", () => ({
    getEntitlements: vi.fn(async () => ({ monthlyMynahSeconds: 54_000 })),
}));

import { db } from "@/db";
import { listUserProviders } from "@/lib/ai/list-providers";
import { getEntitlements } from "@/lib/entitlements";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";
import { RIFFADO_INCLUDED_PROVIDER_ID } from "@/lib/transcription/included-provider";

interface CredentialRow {
    id: string;
    legacyDefault: boolean;
}

function mockQueries(pointer: string | null, credentials: CredentialRow[]) {
    const rows = credentials.map((c) => ({
        id: c.id,
        provider: "Groq",
        baseUrl: null,
        defaultModel: null,
        isDefaultEnhancement: false,
        legacyDefault: c.legacyDefault,
        createdAt: new Date(0),
    }));
    (db.select as Mock)
        .mockReturnValueOnce({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve([{ pointer }]),
                }),
            }),
        })
        .mockReturnValueOnce({
            from: () => ({
                where: () => Promise.resolve(rows),
            }),
        });
}

async function selectedIds() {
    const providers = await listUserProviders("user-1");
    return providers.filter((p) => p.isDefaultTranscription).map((p) => p.id);
}

describe("listUserProviders transcription default", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (isMynahConfigured as Mock).mockReturnValue(true);
    });

    it("marks Mynah when no pointer and no legacy default (hosted fallback)", async () => {
        mockQueries(null, [{ id: "cred-a", legacyDefault: false }]);
        await expect(selectedIds()).resolves.toEqual([
            RIFFADO_INCLUDED_PROVIDER_ID,
        ]);
    });

    it("marks the legacy default credential when no pointer is stored", async () => {
        mockQueries(null, [
            { id: "cred-a", legacyDefault: false },
            { id: "cred-b", legacyDefault: true },
        ]);
        await expect(selectedIds()).resolves.toEqual(["cred-b"]);
    });

    it("marks the pointer over a stale legacy flag", async () => {
        mockQueries("cred-a", [
            { id: "cred-a", legacyDefault: false },
            { id: "cred-b", legacyDefault: true },
        ]);
        await expect(selectedIds()).resolves.toEqual(["cred-a"]);
    });

    it("marks Mynah when the pointer is the sentinel", async () => {
        mockQueries(RIFFADO_INCLUDED_PROVIDER_ID, [
            { id: "cred-a", legacyDefault: false },
        ]);
        await expect(selectedIds()).resolves.toEqual([
            RIFFADO_INCLUDED_PROVIDER_ID,
        ]);
    });

    it("marks nothing on self-host without a pointer or legacy default", async () => {
        (isMynahConfigured as Mock).mockReturnValue(false);
        mockQueries(null, [{ id: "cred-a", legacyDefault: false }]);
        await expect(selectedIds()).resolves.toEqual([]);
    });

    it("marks nothing when the fallback Mynah isn't in the plan", async () => {
        (getEntitlements as Mock).mockResolvedValueOnce({
            monthlyMynahSeconds: 0,
        });
        mockQueries(null, []);
        await expect(selectedIds()).resolves.toEqual([]);
    });

    it("keeps an explicit Mynah choice marked when it isn't in the plan", async () => {
        (getEntitlements as Mock).mockResolvedValueOnce({
            monthlyMynahSeconds: 0,
        });
        mockQueries(RIFFADO_INCLUDED_PROVIDER_ID, []);
        await expect(selectedIds()).resolves.toEqual([
            RIFFADO_INCLUDED_PROVIDER_ID,
        ]);
    });

    it("never returns the internal legacy flag", async () => {
        mockQueries(null, [{ id: "cred-a", legacyDefault: true }]);
        const providers = await listUserProviders("user-1");
        for (const p of providers) {
            expect(p).not.toHaveProperty("legacyDefault");
        }
    });
});
