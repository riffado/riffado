/**
 * @vitest-environment jsdom
 *
 * Settings > Recorders, Plaud account card: account details, Reconnect
 * through the Connect Plaud dialog in its reconnect form, and the
 * Disconnect and Switch account confirms.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { PlaudAccountSection } from "@/components/settings-sections/plaud-account-section";

const DAY_MS = 24 * 60 * 60 * 1000;

let connected = true;
const requests: { url: string; method: string }[] = [];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

beforeEach(() => {
    connected = true;
    requests.length = 0;
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (url === "/api/plaud/connection" && method === "DELETE") {
            connected = false;
            return json({ success: true });
        }
        if (url === "/api/plaud/connection") {
            return json(
                connected
                    ? {
                          connected: true,
                          server: "eu",
                          plaudEmail: "maya@example.com",
                          needsReconnect: false,
                          autoRenews: true,
                          sessionExpiresAt: new Date(
                              Date.now() + 20 * DAY_MS,
                          ).toISOString(),
                      }
                    : { connected: false },
            );
        }
        return json({ success: true });
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    toastMock.success.mockReset();
});

function renderSection(props: { onDisconnected?: () => void } = {}) {
    return render(
        <ConfirmDialogProvider>
            <PlaudAccountSection
                lastSyncAt={new Date(Date.now() - 4 * 60_000).toISOString()}
                {...props}
            />
        </ConfirmDialogProvider>,
    );
}

describe("Plaud account card", () => {
    it("shows who is signed in, the server and the last sync", async () => {
        renderSection();

        expect(await screen.findByText("maya@example.com")).not.toBeNull();
        expect(screen.getByText("Plaud EU")).not.toBeNull();
        expect(screen.getByText("4 minutes ago")).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Reconnect" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Disconnect" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Switch account" }),
        ).not.toBeNull();
    });

    it("reconnects through the dialog that names the account", async () => {
        renderSection();
        fireEvent.click(
            await screen.findByRole("button", { name: "Reconnect" }),
        );

        const dialog = await screen.findByRole("dialog");
        expect(
            within(dialog).getByRole("heading", {
                name: "Sign in to Plaud again",
            }),
        ).not.toBeNull();
        expect(
            within(dialog).getByText("maya@example.com · Plaud EU server"),
        ).not.toBeNull();
    });

    it("disconnects after the confirm", async () => {
        const onDisconnected = vi.fn();
        renderSection({ onDisconnected });
        fireEvent.click(
            await screen.findByRole("button", { name: "Disconnect" }),
        );

        const confirm = await screen.findByRole("alertdialog");
        fireEvent.click(
            within(confirm).getByRole("button", { name: "Disconnect" }),
        );

        await waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
        expect(requests).toContainEqual({
            url: "/api/plaud/connection",
            method: "DELETE",
        });
        expect(
            await screen.findByRole("button", { name: "Sign in with Plaud" }),
        ).not.toBeNull();
    });

    it("unlinks, then opens the dialog to sign in to another account", async () => {
        renderSection();
        fireEvent.click(
            await screen.findByRole("button", { name: "Switch account" }),
        );

        const confirm = await screen.findByRole("alertdialog");
        fireEvent.click(
            within(confirm).getByRole("button", { name: "Switch account" }),
        );

        expect(
            await screen.findByRole("heading", {
                name: "Sign in to another Plaud account",
            }),
        ).not.toBeNull();
        expect(requests).toContainEqual({
            url: "/api/plaud/connection",
            method: "DELETE",
        });
    });
});
