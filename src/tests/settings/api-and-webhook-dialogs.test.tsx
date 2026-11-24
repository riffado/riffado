/**
 * @vitest-environment jsdom
 *
 * API keys are shown once, right after they are made; webhooks list
 * their events in plain words with the id in mono, show the signing
 * secret once on create, and the deliveries read as a dot and a word.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { ApiKeyDialog, expiryDate } from "@/components/settings/api-key-dialog";
import {
    deliveryTime,
    WebhookDeliveriesDialog,
} from "@/components/settings/webhook-deliveries-dialog";
import {
    WebhookEditorDialog,
    webhookErrorField,
} from "@/components/settings/webhook-editor-dialog";
import {
    deliveryState,
    webhookEventLabel,
} from "@/components/settings/webhook-events";
import {
    DEFAULT_WEBHOOK_EVENTS,
    type WebhookEndpoint,
} from "@/components/settings/webhook-types";

const RAW_KEY = "op_7Kq2mR9vXbT4nLwP8sYdE3hJ6cFa1Zu0gN5pW2";

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    fetchMock = vi.fn();
    vi.spyOn(global, "fetch").mockImplementation(
        fetchMock as unknown as typeof fetch,
    );
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("API key dialog", () => {
    it("maps the expiry chips to dates the API accepts", () => {
        const now = new Date(2026, 10, 23, 12, 0, 0);
        expect(expiryDate("30d", "", now)?.getDate()).toBe(23);
        expect(expiryDate("90d", "", now)?.toDateString()).toBe(
            new Date(2027, 1, 21, 12).toDateString(),
        );
        expect(expiryDate("never", "", now)).toBeNull();
        expect(expiryDate("date", "", now)).toBeUndefined();
        expect(expiryDate("date", "2027-03-01", now)).toEqual(
            new Date(2027, 2, 1),
        );
    });

    it("shows a new key once, and not after closing", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                json(
                    {
                        key: RAW_KEY,
                        apiKey: {
                            id: "key-1",
                            name: "Weekly digest script",
                            keyPrefix: "op_7Kq2mR9v",
                            source: "manual",
                            scopes: ["read"],
                            lastUsedAt: null,
                            expiresAt: null,
                            revokedAt: null,
                            createdAt: "2026-11-23T10:00:00.000Z",
                        },
                    },
                    201,
                ),
            ),
        );
        const onCreated = vi.fn();
        const { rerender } = render(
            <ApiKeyDialog open onOpenChange={vi.fn()} onCreated={onCreated} />,
        );
        expect(
            screen.getByRole("heading", { name: "Create an API key" }),
        ).not.toBeNull();
        expect(screen.getByText("Read only")).not.toBeNull();
        fireEvent.change(screen.getByLabelText("Name"), {
            target: { value: "Weekly digest script" },
        });
        fireEvent.click(screen.getByRole("radio", { name: "Never" }));
        expect(screen.getByText("Works until you revoke it")).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Create key" }));

        expect(
            await screen.findByRole("heading", { name: "Copy your new key" }),
        ).not.toBeNull();
        expect(screen.getByTestId("secret-value").textContent).toBe(RAW_KEY);
        expect(
            screen.getByText("You won't see it again after you close this"),
        ).not.toBeNull();
        expect(
            screen.getByText("Weekly digest script · Read only · No expiry"),
        ).not.toBeNull();
        const body = JSON.parse(
            (fetchMock.mock.calls[0] as [string, RequestInit])[1]
                .body as string,
        );
        expect(body).toEqual({
            name: "Weekly digest script",
            expiresAt: null,
            scopes: ["read"],
        });
        expect(onCreated).toHaveBeenCalledWith(
            expect.objectContaining({ id: "key-1" }),
        );
        expect(JSON.stringify(onCreated.mock.calls)).not.toContain(RAW_KEY);

        rerender(
            <ApiKeyDialog
                open={false}
                onOpenChange={vi.fn()}
                onCreated={onCreated}
            />,
        );
        rerender(
            <ApiKeyDialog open onOpenChange={vi.fn()} onCreated={onCreated} />,
        );
        expect(
            await screen.findByRole("heading", { name: "Create an API key" }),
        ).not.toBeNull();
        expect(screen.queryByText(RAW_KEY)).toBeNull();
    });

    it("asks for a name under the field", async () => {
        render(
            <ApiKeyDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Create key" }));
        expect(
            await screen.findByText(
                "Name it so you know which key to revoke later",
            ),
        ).not.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

const WEBHOOK: WebhookEndpoint = {
    id: "wh-1",
    url: "http://n8n:5678/webhook/riffado",
    secret: "whsec_••••k3Qx",
    events: ["transcription.completed", "summary.completed"],
    description: "n8n automations",
    enabled: true,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdAt: "2026-11-01T00:00:00.000Z",
};

function renderEditor(editing: WebhookEndpoint | null) {
    const onSaved = vi.fn();
    render(
        <ConfirmDialogProvider>
            <WebhookEditorDialog
                open
                onOpenChange={vi.fn()}
                editingWebhook={editing}
                events={DEFAULT_WEBHOOK_EVENTS}
                onSaved={onSaved}
            />
        </ConfirmDialogProvider>,
    );
    return { onSaved };
}

describe("webhook editor", () => {
    it("lists every event in plain words with its id", () => {
        renderEditor(WEBHOOK);
        const dialog = screen.getByRole("dialog");
        const events = within(dialog).getByRole("group", { name: "Send when" });
        expect(within(events).getAllByRole("checkbox")).toHaveLength(7);
        expect(
            within(events)
                .getByRole("checkbox", {
                    name: /A transcript is ready/,
                })
                .getAttribute("aria-checked"),
        ).toBe("true");
        expect(
            within(events).getByText("transcription.completed"),
        ).not.toBeNull();
        expect(within(dialog).getByText("2 of 7")).not.toBeNull();
        expect(within(dialog).getByText("whsec_••••k3Qx")).not.toBeNull();
    });

    it("needs at least one event", async () => {
        renderEditor({ ...WEBHOOK, events: ["summary.completed"] });
        fireEvent.click(
            screen.getByRole("checkbox", { name: /A summary is ready/ }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        expect(
            await screen.findByText("Pick at least one event"),
        ).not.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shows the signing secret once after adding", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                json(
                    {
                        webhook: { ...WEBHOOK, id: "wh-2" },
                        secret: "whsec_V1StGXR8Z5jdHi6BmyTq9pLwE3fKcN2a",
                    },
                    201,
                ),
            ),
        );
        const { onSaved } = renderEditor(null);
        expect(
            screen.getByRole("heading", { name: "Add webhook" }),
        ).not.toBeNull();
        fireEvent.change(screen.getByLabelText("Address"), {
            target: { value: "https://example.com/hook" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add webhook" }));
        expect(
            await screen.findByRole("heading", {
                name: "Copy the signing secret",
            }),
        ).not.toBeNull();
        expect(screen.getByTestId("secret-value").textContent).toBe(
            "whsec_V1StGXR8Z5jdHi6BmyTq9pLwE3fKcN2a",
        );
        expect(onSaved).toHaveBeenCalled();
    });

    it("keeps the secret on screen when the list refreshes behind it", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                json(
                    {
                        webhook: { ...WEBHOOK, id: "wh-3" },
                        secret: "whsec_keepme",
                    },
                    201,
                ),
            ),
        );
        function Parent() {
            const [events, setEvents] = useState(DEFAULT_WEBHOOK_EVENTS);
            return (
                <ConfirmDialogProvider>
                    <WebhookEditorDialog
                        open
                        onOpenChange={vi.fn()}
                        editingWebhook={null}
                        events={events}
                        onSaved={() => setEvents([...DEFAULT_WEBHOOK_EVENTS])}
                    />
                </ConfirmDialogProvider>
            );
        }
        render(<Parent />);
        fireEvent.change(screen.getByLabelText("Address"), {
            target: { value: "https://example.com/hook" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add webhook" }));
        expect(await screen.findByText("whsec_keepme")).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.getByText("whsec_keepme")).not.toBeNull();
    });

    it("routes server errors to the field they're about", () => {
        expect(webhookErrorField("Webhook URL must use HTTPS")).toBe("url");
        expect(webhookErrorField("unknown events: foo")).toBe("events");
        expect(webhookErrorField("Something else")).toBe("form");
    });
});

describe("webhook deliveries", () => {
    it("names events and statuses in plain words", () => {
        expect(webhookEventLabel("summary.completed")).toBe(
            "A summary is ready",
        );
        expect(webhookEventLabel("recording.archived")).toBe(
            "Recording archived",
        );
        expect(deliveryState({ status: "dead", attempts: 6 }).label).toBe(
            "Failed",
        );
        expect(deliveryState({ status: "pending", attempts: 2 }).label).toBe(
            "Retrying",
        );
        expect(deliveryState({ status: "success", attempts: 1 }).label).toBe(
            "Delivered",
        );
    });

    it("lists deliveries with status, code, tries and Redeliver", async () => {
        const now = new Date();
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                json({
                    deliveries: [
                        {
                            id: "d-1",
                            event: "summary.completed",
                            status: "dead",
                            attempts: 6,
                            lastAttemptAt: now.toISOString(),
                            nextAttemptAt: now.toISOString(),
                            lastResponseStatus: null,
                            lastError: "timeout",
                            createdAt: now.toISOString(),
                        },
                        {
                            id: "d-2",
                            event: "transcription.completed",
                            status: "success",
                            attempts: 1,
                            lastAttemptAt: now.toISOString(),
                            nextAttemptAt: now.toISOString(),
                            lastResponseStatus: 200,
                            lastError: null,
                            createdAt: now.toISOString(),
                        },
                    ],
                }),
            ),
        );
        render(<WebhookDeliveriesDialog webhook={WEBHOOK} onClose={vi.fn()} />);
        expect(await screen.findByText("Failed")).not.toBeNull();
        expect(screen.getByText("Delivered")).not.toBeNull();
        expect(screen.getByText("6 tries")).not.toBeNull();
        expect(screen.getByText("200")).not.toBeNull();
        expect(
            screen.getByText(
                "Gave up after 6 tries. The last one ended with: timeout",
            ),
        ).not.toBeNull();
        expect(
            screen.getAllByRole("button", { name: "Redeliver" }),
        ).toHaveLength(2);
        expect(deliveryTime(now.toISOString())).toMatch(/^\d\d:\d\d$/);
    });
});
