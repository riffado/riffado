/**
 * @vitest-environment jsdom
 *
 * Phone chrome below `lg`: the top bar shows the sync status and Sync
 * now only with a Plaud connection, and the menu drawer holds the
 * library navigation plus every account item, including the AGPL
 * source offer and Log out.
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { WorkstationHeader } from "@/components/dashboard/workstation-header";
import { APP_SOURCE_URL, APP_VERSION } from "@/lib/version";

afterEach(cleanup);

type HeaderProps = ComponentProps<typeof WorkstationHeader>;

function renderHeader(
    overrides: Partial<Omit<HeaderProps, "drawer">> & {
        drawer?: Partial<HeaderProps["drawer"]>;
    } = {},
) {
    const drawer: HeaderProps["drawer"] = {
        recordingCount: 128,
        devices: [{ serialNumber: "SN-1", name: "Note Pro", model: "note" }],
        plaudNeedsReconnect: false,
        onSearch: vi.fn(),
        onShowLibrary: vi.fn(),
        onOpenSettings: vi.fn(),
        onSettingsIntent: vi.fn(),
        onOpenShortcuts: vi.fn(),
        isAdmin: false,
        isHosted: false,
        userEmail: "maya@example.com",
        userName: "Maya Reed",
        ...overrides.drawer,
    };
    const props: HeaderProps = {
        showSync: true,
        needsReconnect: false,
        lastSyncTime: new Date(Date.now() - 4 * 60_000),
        lastSuccessfulSyncTime: null,
        isAutoSyncing: false,
        lastSyncResult: { success: true },
        onSync: vi.fn(),
        isUploading: false,
        isProcessing: false,
        onTriggerUpload: vi.fn(),
        ...overrides,
        drawer,
    };
    render(<WorkstationHeader {...props} />);
    return { props, drawer };
}

function openDrawer() {
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    return within(screen.getByRole("dialog", { name: "Menu" }));
}

describe("Phone top bar", () => {
    it("shows Library, the sync status, Sync now and Upload", () => {
        renderHeader();
        expect(screen.getByRole("heading", { name: "Library" })).not.toBeNull();
        expect(screen.getByText("Synced 4 min ago")).not.toBeNull();
        expect(screen.getByRole("button", { name: "Sync now" })).not.toBeNull();
        expect(
            screen.getByRole("button", { name: "Upload audio" }),
        ).not.toBeNull();
        expect(
            screen.queryByRole("button", { name: "Account menu" }),
        ).toBeNull();
    });

    it("hides the status and Sync now without a Plaud connection", () => {
        renderHeader({ showSync: false });
        expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
        expect(screen.queryByText(/Synced/)).toBeNull();
        expect(
            screen.getByRole("button", { name: "Upload audio" }),
        ).not.toBeNull();
    });

    it("keeps the last sync but drops Sync now while Plaud needs a reconnect", () => {
        renderHeader({
            needsReconnect: true,
            lastSuccessfulSyncTime: new Date(Date.now() - 2 * 3_600_000),
        });
        expect(screen.getByText("Last synced 2 hours ago")).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    });

    it("runs Sync now and Upload", () => {
        const { props } = renderHeader();
        fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
        fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
        expect(props.onSync).toHaveBeenCalledOnce();
        expect(props.onTriggerUpload).toHaveBeenCalledOnce();
    });
});

describe("Phone menu drawer", () => {
    it("opens from the menu button with the library and account items", () => {
        renderHeader();
        const drawer = openDrawer();
        expect(drawer.getByRole("button", { name: "Search" })).not.toBeNull();
        expect(drawer.getByText("128")).not.toBeNull();
        expect(drawer.getByText("Note Pro")).not.toBeNull();
        expect(drawer.getByText("Via Plaud")).not.toBeNull();
        expect(drawer.getByRole("button", { name: "Settings" })).not.toBeNull();
        expect(drawer.getByText("Maya Reed")).not.toBeNull();
        expect(drawer.getByText("maya@example.com")).not.toBeNull();
        expect(drawer.getByRole("link", { name: "Docs" })).not.toBeNull();
        expect(drawer.getByRole("link", { name: "Changelog" })).not.toBeNull();
        expect(
            drawer.getByRole("button", { name: "Report a bug" }),
        ).not.toBeNull();
        expect(
            drawer
                .getByRole("link", { name: "Source code" })
                .getAttribute("href"),
        ).toBe(APP_SOURCE_URL);
        expect(drawer.getByRole("button", { name: "Log out" })).not.toBeNull();
        expect(drawer.getByText(`Riffado ${APP_VERSION}`)).not.toBeNull();
        expect(drawer.getByRole("link", { name: "AGPL-3.0" })).not.toBeNull();
        expect(drawer.queryByText("Admin dashboard")).toBeNull();
    });

    it("closes with the close button and with Escape", () => {
        renderHeader();
        openDrawer();
        fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
        expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();

        const drawer = openDrawer();
        fireEvent.keyDown(drawer.getByRole("button", { name: "Search" }), {
            key: "Escape",
        });
        expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    });

    it("Search closes the drawer and focuses the list search", () => {
        const { drawer } = renderHeader();
        openDrawer();
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "Search" }));
        });
        expect(drawer.onSearch).toHaveBeenCalledOnce();
        expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    });

    it("leaves Search out when the library is empty", () => {
        renderHeader({
            drawer: {
                recordingCount: 0,
                devices: [],
                onSearch: undefined,
            },
        });
        const drawer = openDrawer();
        expect(drawer.queryByRole("button", { name: "Search" })).toBeNull();
        expect(drawer.queryByText("Recorders")).toBeNull();
        expect(drawer.queryByText("0")).toBeNull();
    });

    it("Library shows the full library and closes", () => {
        const { drawer } = renderHeader();
        const menu = openDrawer();
        fireEvent.click(menu.getByRole("button", { name: /Library/ }));
        expect(drawer.onShowLibrary).toHaveBeenCalledOnce();
        expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    });

    it("shows Admin only for admins", () => {
        renderHeader({
            drawer: { isAdmin: true },
        });
        const drawer = openDrawer();
        expect(
            drawer.getByRole("button", { name: "Admin dashboard" }),
        ).not.toBeNull();
    });
});
