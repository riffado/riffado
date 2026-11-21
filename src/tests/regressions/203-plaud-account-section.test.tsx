/**
 * @vitest-environment jsdom
 *
 * Plaud account settings card (follow-up to issue #203): "Connected until"
 * shows only for a healthy connection, so the ending-soon warning is the
 * one place the end date appears when the sign-in is about to end.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaudAccountSection } from "@/components/settings-sections/plaud-account-section";

const DAY_MS = 24 * 60 * 60 * 1000;

function mockConnection(overrides: Record<string, unknown>) {
    vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(
            JSON.stringify({
                connected: true,
                server: "eu",
                plaudEmail: "me@example.com",
                needsReconnect: false,
                autoRenews: true,
                ...overrides,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("PlaudAccountSection session end", () => {
    it("shows when a healthy connection ends", async () => {
        mockConnection({
            sessionExpiresAt: new Date(Date.now() + 20 * DAY_MS).toISOString(),
        });
        render(<PlaudAccountSection />);

        expect(await screen.findByText(/^Connected until /)).not.toBeNull();
    });

    it("shows the end date only in the warning when the connection ends soon", async () => {
        mockConnection({
            sessionExpiresAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
        });
        render(<PlaudAccountSection />);

        expect(
            await screen.findByText(/^Your Plaud connection ends on /),
        ).not.toBeNull();
        expect(screen.queryByText(/^Connected until /)).toBeNull();
    });

    it("hides the end date when the connection needs a reconnect", async () => {
        mockConnection({
            needsReconnect: true,
            sessionExpiresAt: new Date(Date.now() + 20 * DAY_MS).toISOString(),
        });
        render(<PlaudAccountSection />);

        expect(
            await screen.findByText(/Plaud stopped accepting this sign-in/),
        ).not.toBeNull();
        expect(screen.queryByText(/^Connected until /)).toBeNull();
    });
});
