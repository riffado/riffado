/**
 * @vitest-environment jsdom
 *
 * Account menu (cleanup pass): name and email, no "Signed in" line, no
 * theme switch, no Settings in the sidebar menu (its gear and `,` open
 * Settings), and the about links that used to live in the site footer,
 * including the AGPL source offer.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { UserMenu } from "@/components/dashboard/user-menu";
import { APP_SOURCE_URL, APP_VERSION } from "@/lib/version";

afterEach(cleanup);

function openMenu(props: { isAdmin?: boolean; userName?: string | null }) {
    render(
        <UserMenu
            isAdmin={props.isAdmin ?? false}
            isHosted={false}
            userEmail="maya@example.com"
            userName={props.userName ?? "Maya Lin"}
            onOpenShortcuts={() => {}}
        />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), {
        key: "Enter",
    });
    return within(screen.getByRole("menu"));
}

describe("UserMenu", () => {
    it("shows name and email without a Signed in line or a theme switch", () => {
        const menu = openMenu({});
        expect(menu.getByText("Maya Lin")).not.toBeNull();
        expect(menu.getByText("maya@example.com")).not.toBeNull();
        expect(menu.queryByText("Signed in")).toBeNull();
        expect(menu.queryByText("Theme")).toBeNull();
        expect(menu.queryByRole("radiogroup")).toBeNull();
        expect(menu.queryByRole("radio", { name: /Dark/ })).toBeNull();
    });

    it("leaves Settings out of the sidebar menu", () => {
        const menu = openMenu({});
        expect(menu.queryByRole("menuitem", { name: /Settings/ })).toBeNull();
    });

    it("has the about links, the source offer and the licence", () => {
        const menu = openMenu({});
        const items = menu
            .getAllByRole("menuitem")
            .map((item) => item.textContent?.trim());
        expect(items).toEqual([
            "Keyboard shortcuts?",
            "Docs",
            "Changelog",
            "Report a bug",
            "Source code",
            "Log out",
        ]);
        expect(
            menu
                .getByRole("menuitem", { name: "Source code" })
                .getAttribute("href"),
        ).toBe(APP_SOURCE_URL);
        expect(
            menu.getByRole("link", { name: "AGPL-3.0" }).getAttribute("href"),
        ).toBe("https://www.gnu.org/licenses/agpl-3.0.html");
        expect(
            menu.getByText(`Riffado ${APP_VERSION}`).getAttribute("href"),
        ).toContain(`/releases/tag/v${APP_VERSION}`);
    });

    it("shows Admin only for admins", () => {
        const menu = openMenu({ isAdmin: true });
        expect(
            menu.getByRole("menuitem", { name: "Admin dashboard" }),
        ).not.toBeNull();
    });
});
