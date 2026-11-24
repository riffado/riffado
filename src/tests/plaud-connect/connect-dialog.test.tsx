/**
 * @vitest-environment jsdom
 *
 * The Connect Plaud dialog: connector states (not installed, installed,
 * waiting, connected, error), the Email code and Paste a token views
 * inside the same dialog, and the reconnect form naming the account.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

import {
    type PlaudAccountSummary,
    PlaudConnectDialog,
    type PlaudConnectIntent,
} from "@/components/plaud-connect/connect-dialog";
import type { ConnectorPayload } from "@/components/plaud-connect/connector";

type FetchHandler = (url: string, init?: RequestInit) => Response;

let fetchHandler: FetchHandler;
const fetchCalls: { url: string; body: unknown }[] = [];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function renderDialog(
    props: {
        intent?: PlaudConnectIntent;
        account?: PlaudAccountSummary | null;
        onConnected?: () => void;
    } = {},
) {
    const onConnected = props.onConnected ?? vi.fn();
    render(
        <PlaudConnectDialog
            open
            onOpenChange={() => {}}
            onConnected={onConnected}
            intent={props.intent}
            account={props.account}
        />,
    );
    return { onConnected };
}

function installConnector(connect: () => Promise<ConnectorPayload>) {
    window.__riffadoConnector = { version: 1, connect };
}

const PAYLOAD: ConnectorPayload = {
    accessToken: "ut-token",
    refreshToken: "urt-token",
    apiBase: "https://api-euc1.plaud.ai",
    region: "euc1",
    capturedAt: 0,
};

beforeEach(() => {
    fetchCalls.length = 0;
    fetchHandler = () => json({ success: true });
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        fetchCalls.push({
            url,
            body:
                typeof init?.body === "string"
                    ? JSON.parse(init.body)
                    : undefined,
        });
        return fetchHandler(url, init);
    });
});

afterEach(() => {
    cleanup();
    delete window.__riffadoConnector;
    vi.restoreAllMocks();
    toastMock.success.mockReset();
    toastMock.warning.mockReset();
    toastMock.error.mockReset();
});

describe("Connect Plaud dialog, connector", () => {
    it("leads with three steps and Add Riffado Connector when not installed", () => {
        renderDialog();

        expect(
            screen.getByRole("heading", { name: "Connect your Plaud account" }),
        ).not.toBeNull();
        expect(
            screen.getByText("Add Riffado Connector to your browser"),
        ).not.toBeNull();
        expect(
            screen.getByRole("link", { name: "Add Riffado Connector" }),
        ).not.toBeNull();
        expect(
            screen.getByText(/Stays connected for up to 30 days/),
        ).not.toBeNull();
        expect(
            screen.queryByRole("button", { name: "Continue with Plaud" }),
        ).toBeNull();
    });

    it("offers a reload once the install page was opened", () => {
        renderDialog();
        fireEvent.click(
            screen.getByRole("link", { name: "Add Riffado Connector" }),
        );
        expect(
            screen.getByRole("button", { name: "Reload this page" }),
        ).not.toBeNull();
    });

    it("switches to the installed state when the connector appears", () => {
        renderDialog();
        expect(screen.queryByText("Riffado Connector added")).toBeNull();

        installConnector(() => new Promise(() => {}));
        act(() => {
            window.dispatchEvent(new Event("focus"));
        });

        expect(screen.getByText("Riffado Connector added")).not.toBeNull();
        expect(
            screen.getByText(
                "Up to 30 days with Connector 0.2.4 or newer; older versions about a day",
            ),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        ).not.toBeNull();
    });

    it("waits with a readable status while Plaud sign-in runs", async () => {
        installConnector(() => new Promise(() => {}));
        renderDialog();

        fireEvent.click(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        );

        const status = await screen.findByRole("status");
        expect(status.textContent).toContain("Waiting for plaud.ai sign-in");
        expect(
            screen.getByText(/In progress:/, { exact: false }),
        ).not.toBeNull();
        expect(
            screen.getByText(
                "Finish signing in on the plaud.ai tab. This dialog updates by itself",
            ),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: /Email code/ }),
        ).not.toBeNull();
    });

    it("connects, sends the refresh token and toasts once", async () => {
        installConnector(() => Promise.resolve(PAYLOAD));
        const { onConnected } = renderDialog();

        fireEvent.click(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        );

        await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
        expect(fetchCalls).toContainEqual({
            url: "/api/plaud/auth/connect-token",
            body: {
                accessToken: "ut-token",
                refreshToken: "urt-token",
                apiBase: "https://api-euc1.plaud.ai",
                source: "connector",
            },
        });
        expect(toastMock.success).toHaveBeenCalledTimes(1);
        expect(toastMock.success).toHaveBeenCalledWith(
            "Plaud account connected",
        );
    });

    it("shows a failed connect inside the dialog, above its button", async () => {
        installConnector(() => Promise.resolve(PAYLOAD));
        fetchHandler = () =>
            json(
                {
                    error: "That's a workspace token. Use the pld_ut cookie instead",
                    code: "PLAUD_WORKSPACE_TOKEN",
                },
                400,
            );
        const { onConnected } = renderDialog();

        fireEvent.click(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        );

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("That's a workspace token");
        expect(onConnected).not.toHaveBeenCalled();
        expect(toastMock.error).not.toHaveBeenCalled();
        expect(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        ).not.toBeNull();
    });

    it("shows a connector failure in the dialog", async () => {
        installConnector(() =>
            Promise.reject(new Error("Sign-in tab was closed")),
        );
        renderDialog();

        fireEvent.click(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        );

        expect((await screen.findByRole("alert")).textContent).toContain(
            "Sign-in tab was closed",
        );
    });
});

describe("Connect Plaud dialog, other ways", () => {
    it("opens Email code in the same dialog and comes back", () => {
        renderDialog();

        fireEvent.click(screen.getByRole("button", { name: /Email code/ }));
        expect(
            screen.getByRole("heading", { name: "Email code" }),
        ).not.toBeNull();
        expect(screen.getByLabelText("Plaud email")).not.toBeNull();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Back to all ways to connect",
            }),
        );
        expect(
            screen.getByRole("heading", { name: "Connect your Plaud account" }),
        ).not.toBeNull();
        expect(document.activeElement?.textContent).toContain("Email code");
    });

    it("opens Paste a token in the same dialog and comes back", () => {
        renderDialog();

        fireEvent.click(screen.getByRole("button", { name: /Paste a token/ }));
        expect(
            screen.getByRole("heading", { name: "Paste a token" }),
        ).not.toBeNull();
        expect(screen.getByLabelText("Access token")).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Connect with token" }),
        ).not.toBeNull();

        fireEvent.click(
            screen.getByRole("button", {
                name: "Back to all ways to connect",
            }),
        );
        expect(
            screen.getByRole("heading", { name: "Connect your Plaud account" }),
        ).not.toBeNull();
    });

    it("explains an empty email under the field", () => {
        renderDialog();
        fireEvent.click(screen.getByRole("button", { name: /Email code/ }));

        fireEvent.click(screen.getByRole("button", { name: "Send code" }));

        const input = screen.getByLabelText("Plaud email");
        expect(input.getAttribute("aria-invalid")).toBe("true");
        const noteId = input.getAttribute("aria-describedby");
        expect(noteId).not.toBeNull();
        expect(document.getElementById(noteId ?? "")?.textContent).toContain(
            "Enter the email you use for Plaud",
        );
        expect(fetchCalls).toHaveLength(0);
    });

    it("sends a code, shows the detected region and connects", async () => {
        fetchHandler = (url) =>
            url === "/api/plaud/auth/send-code"
                ? json({
                      otpToken: "otp",
                      apiBase: "https://api-euc1.plaud.ai",
                  })
                : json({ success: true });
        const { onConnected } = renderDialog();
        fireEvent.click(screen.getByRole("button", { name: /Email code/ }));

        fireEvent.change(screen.getByLabelText("Plaud email"), {
            target: { value: "maya@example.com" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send code" }));

        expect(
            await screen.findByText(/EU \(Frankfurt\) server/),
        ).not.toBeNull();
        fireEvent.change(screen.getByLabelText("Verification code"), {
            target: { value: "123456" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Connect account" }),
        );

        await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
        expect(fetchCalls.at(-1)).toEqual({
            url: "/api/plaud/auth/verify",
            body: {
                code: "123456",
                otpToken: "otp",
                apiBase: "https://api-euc1.plaud.ai",
                email: "maya@example.com",
            },
        });
        expect(toastMock.success).toHaveBeenCalledWith(
            "Plaud account connected",
        );
    });

    it("sends a pasted token without its Bearer prefix", async () => {
        const { onConnected } = renderDialog();
        fireEvent.click(screen.getByRole("button", { name: /Paste a token/ }));

        fireEvent.change(screen.getByLabelText("Access token"), {
            target: { value: "Bearer eyJabc" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Connect with token" }),
        );

        await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
        expect(fetchCalls.at(-1)).toEqual({
            url: "/api/plaud/auth/connect-token",
            body: {
                accessToken: "eyJabc",
                apiBase: "https://api.plaud.ai",
                source: "paste",
            },
        });
    });
});

describe("Reconnect Plaud dialog", () => {
    it("names the stored account and its server", () => {
        installConnector(() => new Promise(() => {}));
        renderDialog({
            intent: "reconnect",
            account: { email: "maya@example.com", server: "eu" },
        });

        expect(
            screen.getByRole("heading", { name: "Sign in to Plaud again" }),
        ).not.toBeNull();
        expect(
            screen.getByText("maya@example.com · Plaud EU server"),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Continue with Plaud" }),
        ).not.toBeNull();
        expect(
            screen.getByRole("button", { name: /Email code/ }),
        ).not.toBeNull();
    });

    it("reads the account from the server when the caller has none", async () => {
        fetchHandler = (url) =>
            url === "/api/plaud/connection"
                ? json({
                      connected: true,
                      plaudEmail: "maya@example.com",
                      server: "apse1",
                  })
                : json({ success: true });
        renderDialog({ intent: "reconnect" });

        expect(
            await screen.findByText(
                "maya@example.com · Plaud Asia Pacific server",
            ),
        ).not.toBeNull();
    });

    it("prefills the stored email in the Email code view", () => {
        renderDialog({
            intent: "reconnect",
            account: { email: "maya@example.com", server: "eu" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Email code/ }));

        expect(
            (screen.getByLabelText("Plaud email") as HTMLInputElement).value,
        ).toBe("maya@example.com");
    });
});
