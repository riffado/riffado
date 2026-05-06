import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
    },
}));

vi.mock("@/lib/encryption", () => ({
    encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn((ciphertext: string) =>
        ciphertext.replace(/^encrypted:/, ""),
    ),
}));

import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { emitEvent } from "@/lib/webhooks/emit";

describe("Issue #79 — webhook emission", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates pending deliveries with minimal stored payload metadata", async () => {
        (db.select as Mock).mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ id: "wh-1" }]),
            }),
        });

        const valuesSpy = vi.fn().mockResolvedValue(undefined);
        (db.insert as Mock).mockImplementation((table: unknown) => {
            expect(table).toBe(webhookDeliveries);
            return { values: valuesSpy };
        });

        await emitEvent("recording.synced", "user-79", "rec-1");

        expect(valuesSpy).toHaveBeenCalledTimes(1);
        const values = valuesSpy.mock.calls[0][0] as Array<{
            endpointId: string;
            userId: string;
            recordingId: string;
            event: string;
            status: string;
            payload: Record<string, unknown>;
        }>;
        expect(values).toHaveLength(1);
        expect(values[0].endpointId).toBe("wh-1");
        expect(values[0].userId).toBe("user-79");
        expect(values[0].recordingId).toBe("rec-1");
        expect(values[0].event).toBe("recording.synced");
        expect(values[0].status).toBe("pending");
        expect(values[0].payload.event).toBe("recording.synced");
        expect(values[0].payload.recording_id).toBe("rec-1");
        expect(values[0].payload).not.toHaveProperty("data");
        expect(JSON.stringify(values[0].payload)).not.toContain("transcript");
        expect(JSON.stringify(values[0].payload)).not.toContain("summary");
    });
});
