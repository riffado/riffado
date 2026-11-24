/**
 * @vitest-environment jsdom
 *
 * Onboarding A: a new account lands on the first-run screen with no
 * onboarding dialog, gets a "Welcome to Riffado, {first name}" toast once,
 * and sees one line naming the transcription it will use.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
    refresh: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
}));
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
    useRouter: () => router,
    useSearchParams: () => searchParams.current,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({
    toast,
    setToastSound: vi.fn(),
    chimeNewRecordings: vi.fn(),
}));

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import {
    Workstation,
    welcomeMessage,
} from "@/components/dashboard/workstation";
import { transcriptionNoticeFor } from "@/components/dashboard/workstation-empty-state";
import type { Provider } from "@/components/settings-sections/providers-section";
import { TooltipProvider } from "@/components/ui/tooltip";
import { INITIAL_SETTINGS_DEFAULTS } from "@/lib/settings/initial-settings";

const MYNAH: Provider = {
    id: "riffado-included",
    provider: "Mynah",
    baseUrl: null,
    defaultModel: null,
    isDefaultTranscription: false,
    isDefaultEnhancement: false,
    createdAt: new Date("2026-01-01"),
    managed: true,
    includedSeconds: 36_000,
    available: true,
};

const OWN: Provider = {
    id: "cred-1",
    provider: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3",
    isDefaultTranscription: false,
    isDefaultEnhancement: false,
    createdAt: new Date("2026-01-02"),
};

let providersResponse: Provider[] = [];

function workstationTree(userName: string | null = "Maya Reed") {
    return (
        <ConfirmDialogProvider>
            <TooltipProvider>
                <Workstation
                    recordings={[]}
                    transcriptions={new Map()}
                    userName={userName}
                    devices={[]}
                    initialSettings={{
                        ...INITIAL_SETTINGS_DEFAULTS,
                        // A brand-new account: never finished the old flow.
                        onboardingCompleted: false,
                        autoSyncEnabled: false,
                    }}
                    plaudNeedsReconnect={false}
                    plaudSessionExpiresAt={null}
                    plaudLastSyncAt={null}
                    hasPlaudConnection={false}
                    isHosted={false}
                />
            </TooltipProvider>
        </ConfirmDialogProvider>
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    providersResponse = [];
    searchParams.current = new URLSearchParams();
    window.history.replaceState(null, "", "/dashboard");
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
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    vi.spyOn(global, "fetch").mockImplementation((input) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
        const body =
            url === "/api/settings/ai/providers"
                ? { providers: providersResponse }
                : { success: true };
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("No onboarding dialog", () => {
    it("shows a new account the first-run screen, not a dialog", async () => {
        render(workstationTree());
        await act(async () => {});

        expect(screen.getByText("Your first recording")).not.toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByText(/Get Started/i)).toBeNull();
    });

    it("no page gates on onboarding any more", () => {
        const root = join(__dirname, "..", "..", "..");
        for (const file of [
            "src/lib/auth-server.ts",
            "src/app/(app)/settings/page.tsx",
            "src/app/(app)/recordings/[id]/page.tsx",
            "src/app/(app)/dashboard/page.tsx",
        ]) {
            const source = readFileSync(join(root, file), "utf-8");
            expect(source).not.toContain("requireCompletedOnboarding");
        }
    });
});

describe("Welcome toast after sign-up", () => {
    it("greets by first name once and drops the flag from the URL", async () => {
        searchParams.current = new URLSearchParams("welcome=1");
        window.history.replaceState(null, "", "/dashboard?welcome=1");
        const { rerender } = render(workstationTree());
        await act(async () => {});

        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith("Welcome to Riffado, Maya");
        expect(window.location.search).toBe("");

        rerender(workstationTree());
        await act(async () => {});
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it("doesn't greet on an ordinary visit", async () => {
        render(workstationTree());
        await act(async () => {});

        expect(toast.success).not.toHaveBeenCalled();
    });

    it("falls back when the account has no name", () => {
        expect(welcomeMessage(null)).toBe("Welcome to Riffado");
        expect(welcomeMessage("  ")).toBe("Welcome to Riffado");
        expect(welcomeMessage("Maya Reed")).toBe("Welcome to Riffado, Maya");
    });
});

describe("Transcription line under the cards", () => {
    it("names Mynah when the plan includes it", async () => {
        providersResponse = [MYNAH];
        render(workstationTree());

        expect(
            await screen.findByText(
                /Transcription uses Mynah, included with your plan/,
            ),
        ).not.toBeNull();
        expect(
            screen.getByRole("link", { name: "Change" }).getAttribute("href"),
        ).toBe("/settings#transcription");
    });

    it("offers the browser without a provider", async () => {
        providersResponse = [];
        render(workstationTree());

        expect(
            await screen.findByText(/Transcribe in your browser for free/),
        ).not.toBeNull();
        expect(
            screen
                .getByRole("link", { name: "add a provider" })
                .getAttribute("href"),
        ).toBe("/settings#transcription");
    });

    it("decides from the provider list", () => {
        expect(transcriptionNoticeFor(null)).toBeNull();
        expect(transcriptionNoticeFor([])).toBe("browser");
        expect(transcriptionNoticeFor([MYNAH])).toBe("mynah");
        expect(
            transcriptionNoticeFor([
                { ...MYNAH, isDefaultTranscription: true },
                OWN,
            ]),
        ).toBe("mynah");
        // Own provider chosen, or no default with an own provider: say nothing.
        expect(
            transcriptionNoticeFor([
                MYNAH,
                { ...OWN, isDefaultTranscription: true },
            ]),
        ).toBeNull();
        expect(transcriptionNoticeFor([MYNAH, OWN])).toBeNull();
        expect(transcriptionNoticeFor([OWN])).toBeNull();
        // Mynah locked (lapsed plan) and nothing else: browser.
        expect(transcriptionNoticeFor([{ ...MYNAH, available: false }])).toBe(
            "browser",
        );
    });
});
