import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: { select: vi.fn() },
}));

vi.mock("@/lib/auth-server", () => ({
    requireApiSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/encryption/fields", () => ({
    decryptText: (v: string | null | undefined) =>
        typeof v === "string" ? v.replace(/^enc:/, "") : v,
    decryptJsonField: (v: unknown) =>
        Array.isArray(v)
            ? v.map((x) => (typeof x === "string" ? x.replace(/^enc:/, "") : x))
            : v,
}));

import { GET } from "@/app/api/export/route";
import { db } from "@/db";
import { requireApiSession } from "@/lib/auth-server";

const now = new Date("2026-05-06T12:00:00.000Z");

/**
 * Queues one `db.select()` result. Some callers await `where(...)`
 * directly (recordings/transcriptions/aiEnhancements); the userSettings
 * lookup chains `.limit(1)` off it -- so the `where(...)` return value
 * needs to be both awaitable and have a `.limit()` method. A real
 * `Promise` with `.limit` assigned onto it satisfies both without
 * defining a bare `then` property (which trips the thenable-object
 * lint rule).
 */
function queueSelect(rows: unknown[]) {
    const chain = {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(
                Object.assign(Promise.resolve(rows), {
                    limit: vi.fn().mockResolvedValue(rows),
                }),
            ),
        }),
    };
    (db.select as Mock).mockReturnValueOnce(chain);
}

describe("GET /api/export (regression: summary decryption)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (requireApiSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    it("decrypts the summary/actionItems/keyPoints in the JSON export instead of leaking ciphertext", async () => {
        // 1) userSettings lookup (defaultExportFormat)
        queueSelect([]);
        // 2) recordings
        queueSelect([
            {
                id: "rec-1",
                userId: "user-1",
                filename: "enc:Planning Call",
                duration: 60000,
                startTime: now,
                filesize: 100,
                deletedAt: null,
            },
        ]);
        // 3) transcriptions
        queueSelect([{ recordingId: "rec-1", text: "enc:hello world" }]);
        // 4) aiEnhancements
        queueSelect([
            {
                recordingId: "rec-1",
                summary: "enc:A concise summary",
                actionItems: ["enc:do a thing"],
                keyPoints: ["enc:key point"],
            },
        ]);

        const request = new Request(
            "https://app.example.com/api/export?format=json",
        );
        const response = await GET(request);
        const body = JSON.parse(await response.text());

        expect(body).toHaveLength(1);
        expect(body[0].transcription).toBe("hello world");
        expect(body[0].summary.summary).toBe("A concise summary");
        expect(body[0].summary.actionItems).toEqual(["do a thing"]);
        expect(body[0].summary.keyPoints).toEqual(["key point"]);
        // Never leak the raw ciphertext prefix into the export.
        expect(JSON.stringify(body)).not.toContain("enc:");
    });
});
