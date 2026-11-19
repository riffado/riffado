/**
 * @vitest-environment jsdom
 *
 * Regression for issue #288: opening Settings from the dashboard showed an
 * empty AI Providers list the first time, because the Providers section
 * seeded its state from a list that was still being fetched and never
 * picked up the result.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { Workstation } from "@/components/dashboard/workstation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useProviderList } from "@/hooks/use-provider-list";
import { INITIAL_SETTINGS_DEFAULTS } from "@/lib/settings/initial-settings";

const PROVIDERS = [
    {
        id: "cred-1",
        provider: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "whisper-1",
        isDefaultTranscription: true,
        isDefaultEnhancement: false,
        createdAt: "2026-01-01T00:00:00.000Z",
    },
];

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

let providerRequests = 0;
let releaseProviders: () => void = () => {};

function renderWorkstation() {
    return render(
        <ConfirmDialogProvider>
            <TooltipProvider>
                <Workstation
                    recordings={[]}
                    transcriptions={new Map()}
                    initialSettings={{
                        ...INITIAL_SETTINGS_DEFAULTS,
                        onboardingCompleted: true,
                        autoSyncEnabled: false,
                        syncOnMount: false,
                        syncOnVisibilityChange: false,
                    }}
                    plaudNeedsReconnect={false}
                    plaudSessionExpiresAt={null}
                    isHosted={false}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>,
    );
}

beforeEach(() => {
    providerRequests = 0;
    window.location.hash = "";
    localStorage.clear();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
    vi.spyOn(global, "fetch").mockImplementation((input) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        if (url === "/api/settings/ai/providers") {
            providerRequests++;
            return new Promise((resolve) => {
                releaseProviders = () =>
                    resolve(jsonResponse({ providers: PROVIDERS }));
            });
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("Settings dialog providers on first open (#288)", () => {
    it("shows the configured providers once the list arrives", async () => {
        renderWorkstation();

        act(() => {
            fireEvent.keyDown(window, { key: "," });
        });
        expect(await screen.findByText("AI Providers")).not.toBeNull();
        await waitFor(() => expect(providerRequests).toBe(1));
        expect(screen.queryByText("No providers configured")).toBeNull();

        await act(async () => {
            releaseProviders();
        });

        expect(await screen.findByText("OpenRouter")).not.toBeNull();
        expect(screen.queryByText("No providers configured")).toBeNull();
    });

    it("loads providers before the Settings menu item is clicked", async () => {
        renderWorkstation();

        fireEvent.keyDown(
            screen.getByRole("button", { name: "Account menu" }),
            {
                key: "Enter",
            },
        );
        const item = await screen.findByRole("menuitem", { name: /Settings/ });
        fireEvent.pointerEnter(item);
        expect(providerRequests).toBe(1);
        await act(async () => {
            releaseProviders();
        });

        fireEvent.click(item);
        expect(await screen.findByText("OpenRouter")).not.toBeNull();
        expect(providerRequests).toBe(1);
    });

    it("shows a load error with retry instead of an empty account", async () => {
        vi.mocked(global.fetch).mockImplementation((input) => {
            const url = typeof input === "string" ? input : String(input);
            if (url === "/api/settings/ai/providers") {
                providerRequests++;
                if (providerRequests === 1) {
                    return Promise.resolve(
                        new Response("boom", { status: 500 }),
                    );
                }
                return Promise.resolve(jsonResponse({ providers: PROVIDERS }));
            }
            return Promise.resolve(jsonResponse({}));
        });
        renderWorkstation();

        act(() => {
            fireEvent.keyDown(window, { key: "," });
        });
        expect(
            await screen.findByText("Couldn't load your AI providers."),
        ).not.toBeNull();
        expect(screen.queryByText("No providers configured")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByText("OpenRouter")).not.toBeNull();
        expect(providerRequests).toBe(2);
    });
});

describe("useProviderList", () => {
    it("keeps a saved change when an older request finishes later", async () => {
        const { result } = renderHook(() => useProviderList());

        act(() => {
            result.current.prefetch();
        });
        expect(providerRequests).toBe(1);

        const saved = [{ ...PROVIDERS[0], id: "cred-2", provider: "Groq" }];
        act(() => {
            result.current.replaceProviders(
                saved as unknown as Parameters<
                    typeof result.current.replaceProviders
                >[0],
            );
        });
        await act(async () => {
            releaseProviders();
        });

        expect(result.current.providers?.map((p) => p.provider)).toEqual([
            "Groq",
        ]);
    });

    it("keeps the previous list when a refresh fails", async () => {
        const { result } = renderHook(() => useProviderList());
        act(() => {
            result.current.prefetch();
        });
        await act(async () => {
            releaseProviders();
        });
        expect(result.current.providers).toHaveLength(1);

        vi.mocked(global.fetch).mockResolvedValue(
            new Response("boom", { status: 500 }),
        );
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
        await act(async () => {
            result.current.prefetch();
        });

        expect(result.current.providers).toHaveLength(1);
        expect(result.current.loadFailed).toBe(true);
    });
});
