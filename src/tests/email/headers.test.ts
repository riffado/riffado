import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        APP_URL: "https://riffado.com",
    },
}));

import { buildUnsubscribeHeaders } from "@/lib/email/headers";

describe("buildUnsubscribeHeaders -- RFC 8058 one-click", () => {
    it("wraps URL in angle brackets and includes mailto fallback", () => {
        const headers = buildUnsubscribeHeaders(
            "https://riffado.com/api/email/unsubscribe?u=abc&t=xyz",
            "unsubscribe@riffado.com",
        );
        expect(headers["List-Unsubscribe"]).toBe(
            "<https://riffado.com/api/email/unsubscribe?u=abc&t=xyz>, <mailto:unsubscribe@riffado.com>",
        );
    });

    it("sets List-Unsubscribe-Post exactly as Gmail/Yahoo expect", () => {
        const headers = buildUnsubscribeHeaders(
            "https://riffado.com/x",
            "x@riffado.com",
        );
        // The exact value is normative -- Gmail's bulk-sender doc
        // requires `List-Unsubscribe=One-Click` verbatim.
        expect(headers["List-Unsubscribe-Post"]).toBe(
            "List-Unsubscribe=One-Click",
        );
    });

    it("falls back to a synthesized mailto when none provided", () => {
        const headers = buildUnsubscribeHeaders("https://riffado.com/x");
        // The mailto must exist; format `<mailto:something@host>`.
        expect(headers["List-Unsubscribe"]).toMatch(/<mailto:[^@]+@[^>]+>$/);
    });
});
