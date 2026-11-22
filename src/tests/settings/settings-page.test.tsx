/**
 * @vitest-environment jsdom
 *
 * Settings is a full page (`/settings`) with its own navigation. Old
 * section hashes (`#providers`, `#sync`, ...) are aliases that open the
 * page holding that section, and every old section's heading is on its
 * new page.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const prefetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, refresh, prefetch, back: vi.fn() }),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { SettingsPageContent } from "@/components/settings/settings-page-content";
import type { Provider } from "@/components/settings-sections/providers-section";
import { TooltipProvider } from "@/components/ui/tooltip";

const PROVIDERS: Provider[] = [
    {
        id: "cred-1",
        provider: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "whisper-1",
        isDefaultTranscription: true,
        isDefaultEnhancement: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
];

const BILLING_STATE = {
    enabled: true,
    plan: "hosted_pro",
    planTransitionUntil: null,
    foundingMember: false,
    everPaidAt: "2026-01-01T00:00:00.000Z",
    grace: null,
    entitlements: {
        maxStorageBytes: 50 * 1024 ** 3,
        maxDevices: null,
        monthlyMynahSeconds: 15 * 3600,
    },
    usage: {
        storageBytes: 18 * 1024 ** 3,
        monthlyMynahSecondsRemaining: 10 * 3600,
        monthlyMynahGrantResetAt: "2026-12-01T00:00:00.000Z",
    },
    pricing: {
        monthly: {
            founding: { usd: null, eur: null },
            standard: { usd: null, eur: null },
        },
        annual: { usd: null, eur: null },
    },
    subscription: {
        id: "sub_1",
        status: "active",
        nextPaymentAt: "2026-12-01T00:00:00.000Z",
        canceledAt: null,
        amountValue: "12.00",
        amountCurrency: "usd",
        interval: "1 month",
    },
};

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function responseFor(url: string): unknown {
    if (url.startsWith("/api/plaud/connection")) return { connected: false };
    if (url.startsWith("/api/settings/api-keys")) return { apiKeys: [] };
    if (url.startsWith("/api/settings/webhooks")) {
        return { webhooks: [], events: [] };
    }
    if (url.startsWith("/api/settings/storage")) {
        return {
            storageType: "local",
            usedBytes: 0,
            recordingCount: 0,
            totalDurationMs: 0,
            largest: [],
            diskFreeBytes: null,
            quotaBytes: null,
        };
    }
    if (url.startsWith("/api/backup")) return { jobs: [] };
    if (url.startsWith("/api/billing/me")) return BILLING_STATE;
    if (url.startsWith("/api/settings/ai/providers")) {
        return { providers: PROVIDERS };
    }
    return {};
}

let requestedUrls: string[] = [];

function renderSettings({
    hash = "",
    isHosted = false,
}: {
    hash?: string;
    isHosted?: boolean;
} = {}) {
    window.history.replaceState(null, "", `/settings${hash}`);
    return render(
        <ConfirmDialogProvider>
            <TooltipProvider>
                <SettingsPageContent
                    initialProviders={PROVIDERS}
                    isHosted={isHosted}
                    devices={[]}
                    plaudLastSyncAt={null}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>,
    );
}

/** The desktop sidebar nav (jsdom applies no media queries, so the phone list renders too). */
function sidebarNav() {
    return within(screen.getAllByRole("navigation", { name: "Settings" })[0]);
}

beforeEach(() => {
    requestedUrls = [];
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    // Radix Slider (Preferences) measures itself.
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo;
    window.scrollTo = vi.fn() as typeof window.scrollTo;
    vi.spyOn(global, "fetch").mockImplementation((input) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        requestedUrls.push(url);
        return Promise.resolve(jsonResponse(responseFor(url)));
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    push.mockReset();
    refresh.mockReset();
    prefetch.mockReset();
});

describe("settings navigation", () => {
    it("lists the new pages on self-host, without Plan & usage", () => {
        renderSettings();
        const nav = sidebarNav();
        const labels = [
            "Recorders",
            "Transcription",
            "AI for summaries",
            "Server & storage",
            "API & webhooks",
            "Export & backup",
            "Preferences",
            // Not a production build in tests.
            "Developer tools",
        ];
        expect(nav.getAllByRole("button")).toEqual(
            labels.map((name) => nav.getByRole("button", { name })),
        );
        expect(nav.queryByRole("button", { name: "Plan & usage" })).toBeNull();
    });

    it("puts Plan & usage first when hosted", () => {
        renderSettings({ isHosted: true });
        const nav = sidebarNav();
        expect(nav.getAllByRole("button")[0]).toBe(
            nav.getByRole("button", { name: "Plan & usage" }),
        );
    });

    it("opens AI for summaries for the old #providers link", async () => {
        renderSettings({ hash: "#providers" });
        expect(
            await screen.findByRole("heading", {
                level: 1,
                name: "AI for summaries",
            }),
        ).not.toBeNull();
        expect(
            screen.getByRole("heading", { level: 2, name: "Providers" }),
        ).not.toBeNull();
        // Providers come from the server render: shown without a fetch.
        expect(screen.getByText("OpenRouter")).not.toBeNull();
        expect(requestedUrls).not.toContain("/api/settings/ai/providers");
        expect(window.location.hash).toBe("#ai");
    });

    it("opens Recorders for the old #sync link", async () => {
        renderSettings({ hash: "#sync" });
        expect(
            await screen.findByRole("heading", { level: 1, name: "Recorders" }),
        ).not.toBeNull();
        expect(
            await screen.findByRole("heading", { level: 2, name: "Sync" }),
        ).not.toBeNull();
    });

    it("ignores #billing on self-host and falls back to the first page", async () => {
        renderSettings({ hash: "#billing" });
        expect(
            await screen.findByRole("heading", { level: 1, name: "Recorders" }),
        ).not.toBeNull();
    });

    it("reopens the last page when there is no hash", async () => {
        localStorage.setItem("settings-last-section", "export");
        renderSettings();
        expect(
            await screen.findByRole("heading", {
                level: 1,
                name: "Export & backup",
            }),
        ).not.toBeNull();
    });

    it("switches pages from the nav and returns to the Library on Escape", async () => {
        renderSettings({ hash: "#recorders" });
        fireEvent.click(
            sidebarNav().getByRole("button", { name: "API & webhooks" }),
        );
        expect(
            await screen.findByRole("heading", {
                level: 1,
                name: "API & webhooks",
            }),
        ).not.toBeNull();
        expect(localStorage.getItem("settings-last-section")).toBe("api");

        act(() => {
            fireEvent.keyDown(window, { key: "Escape" });
        });
        expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("moves between nav items with the arrow keys", () => {
        renderSettings({ hash: "#transcription" });
        const nav = sidebarNav();
        const transcription = nav.getByRole("button", {
            name: "Transcription",
        });
        transcription.focus();
        fireEvent.keyDown(transcription, { key: "ArrowDown" });
        expect(document.activeElement).toBe(
            nav.getByRole("button", { name: "AI for summaries" }),
        );
        fireEvent.keyDown(document.activeElement as Element, {
            key: "ArrowUp",
        });
        expect(document.activeElement).toBe(transcription);
    });
});

describe("every old section is on its new page", () => {
    const cases: {
        hash: string;
        title: string;
        headings: string[];
        hosted?: boolean;
    }[] = [
        {
            hash: "#billing",
            title: "Plan & usage",
            headings: ["Usage", "Subscription", "Delete account"],
            hosted: true,
        },
        { hash: "#plaud-account", title: "Recorders", headings: ["Sources"] },
        { hash: "#sync", title: "Recorders", headings: ["Sync"] },
        { hash: "#transcription", title: "Transcription", headings: [] },
        {
            hash: "#providers",
            title: "AI for summaries",
            headings: ["Providers"],
        },
        {
            hash: "#summary",
            title: "AI for summaries",
            headings: ["Summaries", "Titles"],
        },
        { hash: "#storage", title: "Server & storage", headings: ["Storage"] },
        { hash: "#api-keys", title: "API & webhooks", headings: ["API keys"] },
        { hash: "#webhooks", title: "API & webhooks", headings: ["Webhooks"] },
        { hash: "#export", title: "Export & backup", headings: ["Download"] },
        { hash: "#playback", title: "Preferences", headings: ["Playback"] },
        { hash: "#display", title: "Preferences", headings: ["Display"] },
        {
            hash: "#notifications",
            title: "Preferences",
            headings: ["Notifications"],
        },
        {
            hash: "#dev",
            title: "Developer tools",
            headings: ["Plaud connection"],
        },
    ];

    for (const { hash, title, headings, hosted } of cases) {
        it(`${hash} shows ${title}`, async () => {
            renderSettings({ hash, isHosted: hosted });
            expect(
                await screen.findByRole("heading", { level: 1, name: title }),
            ).not.toBeNull();
            for (const heading of headings) {
                expect(
                    await screen.findByRole("heading", {
                        level: 2,
                        name: heading,
                    }),
                ).not.toBeNull();
            }
        });
    }

    it("keeps the Plaud account card on Recorders", async () => {
        renderSettings({ hash: "#plaud-account" });
        expect(await screen.findByText("Plaud account")).not.toBeNull();
    });
});
