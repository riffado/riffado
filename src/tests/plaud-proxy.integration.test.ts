import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: process.env.WEBSHARE_API_KEY,
}));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { plaudFetch } from "@/lib/plaud/fetch";

const bearerToken = process.env.PLAUD_BEARER_TOKEN;
const webshareKey = process.env.WEBSHARE_API_KEY;
const hasCreds =
    typeof bearerToken === "string" &&
    bearerToken.length > 0 &&
    typeof webshareKey === "string" &&
    webshareKey.length > 0;

if (!hasCreds) {
    console.warn(
        "Skipping plaudFetch+Webshare integration tests: set both PLAUD_BEARER_TOKEN and WEBSHARE_API_KEY to run.",
    );
}

const describeIntegration = hasCreds ? describe : describe.skip;

const PLAUD_URL =
    "https://api-euc1.plaud.ai/team-app/workspaces/list?need_personal_workspace=true";

async function callPlaud(): Promise<Response> {
    return plaudFetch(PLAUD_URL, {
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
        },
    });
}

const REAL_NETWORK_TIMEOUT_MS = 30_000;

describeIntegration("plaudFetch through Webshare", () => {
    it(
        "returns HTTP 200 with a real Plaud JSON body",
        async () => {
            const res = await callPlaud();
            expect(res.status).toBe(200);

            const ct = res.headers.get("content-type") ?? "";
            expect(ct).toContain("application/json");

            const body = (await res.json()) as { status?: unknown };
            expect(body.status).toBe(0);
        },
        REAL_NETWORK_TIMEOUT_MS,
    );

    it(
        "returns 200 on three consecutive calls",
        async () => {
            for (let i = 0; i < 3; i++) {
                const res = await callPlaud();
                expect(res.status).toBe(200);
                await res.text();
            }
        },
        REAL_NETWORK_TIMEOUT_MS,
    );
});
