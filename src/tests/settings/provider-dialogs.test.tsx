/**
 * @vitest-environment jsdom
 *
 * Add provider is two steps (preset grid, then the form); Edit keeps the
 * saved key hidden and says what a delete stops. The copy helpers follow
 * the user's real defaults.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
    toast: {
        success: (...args: unknown[]) => toastSuccess(...args),
        error: vi.fn(),
    },
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { AddProviderDialog } from "@/components/settings/add-provider-dialog";
import { EditProviderDialog } from "@/components/settings/edit-provider-dialog";
import {
    defaultChangeLine,
    displayAddress,
    providerRemovalCopy,
    whatGetsSent,
} from "@/components/settings/provider-form";
import type { Provider } from "@/components/settings-sections/providers-section";

const OPENAI: Provider = {
    id: "cred-openai",
    provider: "OpenAI",
    baseUrl: null,
    defaultModel: "gpt-4o-mini-transcribe",
    isDefaultTranscription: true,
    isDefaultEnhancement: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const GROQ: Provider = {
    id: "cred-groq",
    provider: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3-turbo",
    isDefaultTranscription: false,
    isDefaultEnhancement: false,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
};

const MYNAH: Provider = {
    id: "riffado-included",
    provider: "Mynah",
    baseUrl: null,
    defaultModel: null,
    isDefaultTranscription: false,
    isDefaultEnhancement: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    managed: true,
    available: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

beforeEach(() => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    fetchMock = vi.fn(() => Promise.resolve(json({ provider: {} })));
    vi.spyOn(global, "fetch").mockImplementation(
        fetchMock as unknown as typeof fetch,
    );
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    toastSuccess.mockReset();
});

function renderAdd(opts: { isHosted?: boolean; providers?: Provider[] } = {}) {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    render(
        <AddProviderDialog
            open
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
            isHosted={opts.isHosted}
            providers={opts.providers ?? [OPENAI]}
        />,
    );
    return { onSuccess, onOpenChange };
}

describe("Add provider", () => {
    it("starts on the preset grid, grouped as in the design", () => {
        renderAdd();
        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getByRole("heading", { name: "Add a provider" }),
        ).not.toBeNull();
        const cloud = within(dialog).getByRole("region", {
            name: "Cloud services",
        });
        for (const name of [
            "OpenAI",
            "Groq",
            "Together AI",
            "OpenRouter",
            "Google Gemini",
            "ElevenLabs",
        ]) {
            expect(
                within(cloud).getByRole("button", { name: new RegExp(name) }),
            ).not.toBeNull();
        }
        const local = within(dialog).getByRole("region", {
            name: "On your server",
        });
        expect(within(local).getAllByRole("button")).toHaveLength(2);
        expect(
            within(dialog).getByRole("button", { name: /Another service/ }),
        ).not.toBeNull();
    });

    it("hides the servers you run on hosted", () => {
        renderAdd({ isHosted: true });
        expect(
            screen.queryByRole("region", { name: "On your server" }),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: /LM Studio/ })).toBeNull();
    });

    it("moves to the form for a preset, and back", () => {
        renderAdd();
        fireEvent.click(screen.getByRole("button", { name: /Groq/ }));
        expect(
            screen.getByRole("heading", { name: "Add Groq" }),
        ).not.toBeNull();
        expect(
            screen.getByText("Paste a key from your Groq account"),
        ).not.toBeNull();
        expect(screen.getByText("api.groq.com/openai/v1")).not.toBeNull();
        expect(
            screen.getAllByText("Replaces OpenAI as your default"),
        ).toHaveLength(2);
        expect(screen.getByText("What gets sent to Groq")).not.toBeNull();

        fireEvent.click(
            screen.getByRole("button", { name: "Choose another provider" }),
        );
        expect(
            screen.getByRole("heading", { name: "Add a provider" }),
        ).not.toBeNull();
    });

    it("asks for the key under its field before saving", async () => {
        renderAdd();
        fireEvent.click(screen.getByRole("button", { name: /Groq/ }));
        fireEvent.click(screen.getByRole("button", { name: "Add Groq" }));
        expect(
            await screen.findByText("Paste a key from your Groq account", {
                selector: "span",
            }),
        ).not.toBeNull();
        expect(
            screen.getByLabelText("API key").getAttribute("aria-invalid"),
        ).toBe("true");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("saves the preset with its address, model and uses", async () => {
        const { onSuccess } = renderAdd();
        fireEvent.click(screen.getByRole("button", { name: /Groq/ }));
        fireEvent.change(screen.getByLabelText("API key"), {
            target: { value: "gsk_test" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add Groq" }));
        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/settings/ai/providers");
        expect(JSON.parse(init.body as string)).toEqual({
            provider: "Groq",
            apiKey: "gsk_test",
            baseUrl: "https://api.groq.com/openai/v1",
            defaultModel: "whisper-large-v3-turbo",
            isDefaultTranscription: true,
            isDefaultEnhancement: true,
        });
        expect(toastSuccess).toHaveBeenCalledWith("Groq added");
    });

    it("leaves Mynah as the transcription default unless asked", async () => {
        renderAdd({ providers: [{ ...MYNAH, isDefaultTranscription: true }] });
        fireEvent.click(screen.getByRole("button", { name: /Groq/ }));
        const [transcription] = screen.getAllByRole("checkbox");
        expect(transcription.getAttribute("aria-checked")).toBe("false");
    });

    it("shows an address error under the address", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                json(
                    {
                        error: "We can't reach `localhost` from the hosted app",
                        code: "INVALID_INPUT",
                        details: { field: "baseUrl" },
                    },
                    400,
                ),
            ),
        );
        renderAdd();
        fireEvent.click(
            screen.getByRole("button", { name: /Another service/ }),
        );
        expect(
            screen.getByRole("heading", { name: "Add another service" }),
        ).not.toBeNull();
        fireEvent.change(screen.getByLabelText("Address"), {
            target: { value: "http://localhost:8000/v1" },
        });
        fireEvent.change(screen.getByLabelText("API key"), {
            target: { value: "key" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add service" }));
        expect(
            await screen.findByText(
                "We can't reach `localhost` from the hosted app",
            ),
        ).not.toBeNull();
        expect(
            screen.getByLabelText("Address").getAttribute("aria-invalid"),
        ).toBe("true");
    });
});

describe("Edit provider", () => {
    function renderEdit(provider: Provider, providers: Provider[]) {
        const onSuccess = vi.fn();
        render(
            <ConfirmDialogProvider>
                <EditProviderDialog
                    open
                    onOpenChange={vi.fn()}
                    provider={provider}
                    providers={providers}
                    onSuccess={onSuccess}
                />
            </ConfirmDialogProvider>,
        );
        return { onSuccess };
    }

    it("keeps the saved key hidden until Replace", () => {
        renderEdit(OPENAI, [OPENAI, GROQ]);
        expect(screen.getByText("Saved key, hidden")).not.toBeNull();
        expect(
            screen.getByText("Your provider for transcription and summaries"),
        ).not.toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Replace" }));
        expect(screen.getByLabelText("API key")).not.toBeNull();
    });

    it("doesn't send a key unless one was replaced", async () => {
        const { onSuccess } = renderEdit(GROQ, [OPENAI, GROQ]);
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/settings/ai/providers/cred-groq");
        const body = JSON.parse(init.body as string);
        expect(body).not.toHaveProperty("apiKey");
        expect(body.isDefaultTranscription).toBe(false);
    });

    it("says what stops working before deleting", async () => {
        renderEdit(OPENAI, [OPENAI]);
        fireEvent.click(
            screen.getByRole("button", { name: "Delete provider" }),
        );
        const confirm = await screen.findByRole("alertdialog");
        expect(
            within(confirm).getByRole("heading", { name: "Delete OpenAI?" }),
        ).not.toBeNull();
        expect(confirm.textContent).toContain(
            "won't be transcribed or summarized until you choose another one",
        );
        fireEvent.click(
            within(confirm).getByRole("button", { name: "Delete provider" }),
        );
        await vi.waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/settings/ai/providers/cred-openai",
                { method: "DELETE" },
            ),
        );
    });
});

describe("provider copy", () => {
    it("names the default a new provider replaces", () => {
        expect(
            defaultChangeLine({
                checked: true,
                isCurrent: false,
                otherDefault: "OpenAI",
            }),
        ).toBe("Replaces OpenAI as your default");
        expect(
            defaultChangeLine({
                checked: true,
                isCurrent: false,
                otherDefault: null,
            }),
        ).toBe("Becomes your default");
        expect(
            defaultChangeLine({
                checked: false,
                isCurrent: true,
                otherDefault: null,
            }),
        ).toBe("Stops being your default");
    });

    it("says transcription goes back to Mynah when the plan has it", () => {
        expect(providerRemovalCopy(OPENAI, [MYNAH, OPENAI, GROQ])).toBe(
            "It's your provider for transcription, so new recordings go back to Mynah. Summaries and titles move to Groq. Transcripts it already made stay.",
        );
    });

    it("says nothing else changes for a provider that isn't a default", () => {
        expect(providerRemovalCopy(GROQ, [OPENAI, GROQ])).toBe(
            "It isn't your default for anything, so nothing else changes. Transcripts it already made stay.",
        );
    });

    it("describes what gets sent for the ticked uses", () => {
        expect(
            whatGetsSent({
                transcription: false,
                summaries: true,
                onYourServer: false,
            }),
        ).toBe(
            "Transcript text when it writes a summary or title, never audio. Your key is stored encrypted.",
        );
    });

    it("shows addresses without the scheme", () => {
        expect(displayAddress("https://api.groq.com/openai/v1/")).toBe(
            "api.groq.com/openai/v1",
        );
    });
});
