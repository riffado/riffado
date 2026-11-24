/**
 * @vitest-environment jsdom
 *
 * Regression for issue #288: opening Settings from the dashboard showed an
 * empty AI Providers list the first time, because the Providers section
 * seeded its state from a list that was still being fetched and never
 * picked up the result.
 *
 * Settings is now its own page that reads providers on the server, so the
 * list is complete on first paint. The dashboard entry points navigate to
 * it and warm the route on intent.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const prefetch = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push, prefetch }),
    useSearchParams: () => searchParams,
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { Workstation } from "@/components/dashboard/workstation";
import { SettingsPageContent } from "@/components/settings/settings-page-content";
import {
    type Provider,
    ProvidersSection,
} from "@/components/settings-sections/providers-section";
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
                    userName={null}
                    devices={[]}
                    initialSettings={{
                        ...INITIAL_SETTINGS_DEFAULTS,
                        onboardingCompleted: true,
                        autoSyncEnabled: false,
                        syncOnMount: false,
                        syncOnVisibilityChange: false,
                    }}
                    plaudNeedsReconnect={false}
                    plaudSessionExpiresAt={null}
                    plaudLastSyncAt={null}
                    hasPlaudConnection={false}
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
    Element.prototype.scrollIntoView = vi.fn();
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
        if (url === "/api/plaud/connection") {
            return Promise.resolve(jsonResponse({ connected: false }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    push.mockReset();
    prefetch.mockReset();
});

describe("Settings providers on first open (#288)", () => {
    it("opens the Settings page from the keyboard shortcut", () => {
        renderWorkstation();

        act(() => {
            fireEvent.keyDown(window, { key: "," });
        });
        expect(push).toHaveBeenCalledWith("/settings");
    });

    it("warms the Settings route before the menu item is clicked", async () => {
        renderWorkstation();

        // Below lg, Settings sits in the menu drawer (the sidebar has a
        // gear). jsdom applies no media queries, so the top bar is present.
        fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
        const item = await screen.findByRole("button", { name: "Settings" });
        fireEvent.pointerDown(item);
        expect(prefetch).toHaveBeenCalledWith("/settings");

        fireEvent.click(item);
        expect(push).toHaveBeenCalledWith("/settings");
    });

    it("shows the configured providers on first paint", async () => {
        window.history.replaceState(null, "", "/settings#providers");
        render(
            <ConfirmDialogProvider>
                <SettingsPageContent
                    initialProviders={PROVIDERS as unknown as Provider[]}
                    devices={[]}
                    plaudLastSyncAt={null}
                    hasPlaudConnection={false}
                />
            </ConfirmDialogProvider>,
        );

        expect(await screen.findByText("OpenRouter")).not.toBeNull();
        expect(screen.queryByText("No providers yet")).toBeNull();
        expect(providerRequests).toBe(0);
    });

    it("shows a load error with retry instead of an empty account", () => {
        const onRetry = vi.fn();
        render(
            <ConfirmDialogProvider>
                <ProvidersSection
                    providers={null}
                    onProvidersChange={vi.fn()}
                    loadFailed
                    onRetry={onRetry}
                />
            </ConfirmDialogProvider>,
        );

        expect(
            screen.getByText("Couldn't load your AI providers."),
        ).not.toBeNull();
        expect(screen.queryByText("No providers yet")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
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
