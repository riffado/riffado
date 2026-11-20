/**
 * ChatGPT plan usage is opt-in per instance (ENABLE_CHATGPT_PLAN_USAGE)
 * and never available on hosted. Turning the flag off must also stop an
 * existing connection from being used.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
    mockEnv: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        IS_HOSTED: false,
        ENABLE_CHATGPT_PLAN_USAGE: false,
    },
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

vi.mock("@/db", () => ({
    db: { select: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

import { runChatGptCompletion } from "@/lib/ai/chatgpt/connect";
import {
    assertChatGptPlanUsageEnabled,
    isChatGptPlanUsageEnabled,
} from "@/lib/ai/chatgpt/feature";
import { ErrorCode } from "@/lib/errors";

beforeEach(() => {
    mockEnv.IS_HOSTED = false;
    mockEnv.ENABLE_CHATGPT_PLAN_USAGE = false;
});

describe("ChatGPT plan usage feature flag", () => {
    it("is off by default on self-host", () => {
        expect(isChatGptPlanUsageEnabled()).toBe(false);
        expect(() => assertChatGptPlanUsageEnabled()).toThrow(
            /ENABLE_CHATGPT_PLAN_USAGE=true/,
        );
    });

    it("is on when the operator opts in", () => {
        mockEnv.ENABLE_CHATGPT_PLAN_USAGE = true;
        expect(isChatGptPlanUsageEnabled()).toBe(true);
        expect(() => assertChatGptPlanUsageEnabled()).not.toThrow();
    });

    it("stays off on hosted even with the flag set", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.ENABLE_CHATGPT_PLAN_USAGE = true;
        expect(isChatGptPlanUsageEnabled()).toBe(false);
        try {
            assertChatGptPlanUsageEnabled();
            expect.unreachable();
        } catch (error) {
            // Hosted gets a plain 404 that doesn't advertise the flag.
            expect(error).toMatchObject({
                code: ErrorCode.NOT_FOUND,
                message: "Not found",
            });
        }
    });

    it("refuses to use an existing connection once the flag is off", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        await expect(
            runChatGptCompletion(
                {
                    id: "c1",
                    userId: "u1",
                    apiKey: "sealed",
                    defaultModel: "m",
                },
                { instructions: "i", input: "transcript" },
            ),
        ).rejects.toMatchObject({
            code: ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            details: expect.objectContaining({ disabled: true }),
        });
        // Nothing left the server.
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
