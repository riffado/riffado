"use client";

import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import {
    type NavItem,
    resolveSettingsHash,
    SETTINGS_STORAGE_KEY,
} from "@/components/settings-nav-config";
import type { SettingsPage } from "@/types/settings";

const NAV_ITEM_SELECTOR = "[data-settings-nav-item]";

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
    );
}

/** True while a dialog, menu or listbox from Radix is open on top of the page. */
function hasOpenOverlay(): boolean {
    return (
        document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        ) !== null
    );
}

/**
 * Navigation state for the settings page.
 *
 * - The page comes from the URL hash (a page id or an old section id such
 *   as `#providers`), then from the last page visited, then the first
 *   page. It is null until the client has read the hash, so the server
 *   never renders the wrong page first.
 * - Changing page rewrites the hash with `history.replaceState`, so the
 *   back button leaves Settings instead of stepping through pages, and
 *   remembers the page in localStorage. In-app hash writes (e.g. the
 *   billing "Export my data" button) still switch pages via `hashchange`.
 * - When the hash named a section inside a page, `anchor` holds the id of
 *   that block so the page can scroll to it once it has rendered.
 * - Escape returns to the Library unless a dialog, menu or field has it.
 *   Arrow keys, Home and End move between nav items while one has focus
 *   (with nothing focused, an arrow key focuses the active item); Enter
 *   and Space open the focused item.
 */
export function useSettingsNav({
    nav,
    onExit,
}: {
    nav: NavItem[];
    onExit: () => void;
}) {
    const [activePage, setActivePageState] = useState<SettingsPage | null>(
        null,
    );
    const [anchor, setAnchor] = useState<string | null>(null);
    const [openedFromHash, setOpenedFromHash] = useState(false);

    useEffect(() => {
        const applyHash = (): boolean => {
            const resolved = resolveSettingsHash(
                window.location.hash.slice(1),
                nav,
            );
            if (!resolved) return false;
            setActivePageState(resolved.page);
            setAnchor(resolved.anchor ?? null);
            return true;
        };

        if (applyHash()) {
            setOpenedFromHash(true);
        } else {
            const stored = resolveSettingsHash(
                localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "",
                nav,
            );
            setActivePageState(stored?.page ?? nav[0]?.id ?? null);
        }

        const onHashChange = () => {
            applyHash();
        };
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, [nav]);

    useEffect(() => {
        if (!activePage) return;
        const url = `${window.location.pathname}${window.location.search}#${activePage}`;
        window.history.replaceState(window.history.state, "", url);
        localStorage.setItem(SETTINGS_STORAGE_KEY, activePage);
    }, [activePage]);

    // Arrow keys reach the nav without a click first, as they did when
    // Settings was a dialog: with nothing focused, ArrowUp/ArrowDown put
    // focus on the active item (only while the sidebar is visible).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (e.defaultPrevented) return;
            const focused = document.activeElement;
            if (focused && focused !== document.body) return;
            const item = document.querySelector<HTMLElement>(
                `${NAV_ITEM_SELECTOR}[data-page="${activePage}"]`,
            );
            if (!item || item.offsetParent === null) return;
            e.preventDefault();
            item.focus();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [activePage]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (isTypingTarget(e.target) || hasOpenOverlay()) return;
            e.preventDefault();
            onExit();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onExit]);

    const setActivePage = useCallback((page: SettingsPage) => {
        setActivePageState(page);
        setAnchor(null);
    }, []);

    const clearAnchor = useCallback(() => setAnchor(null), []);

    /** Roving focus for the nav list; attach to the element wrapping the items. */
    const onNavKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR),
        );
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next = current;
        if (e.key === "ArrowDown")
            next = Math.min(current + 1, items.length - 1);
        if (e.key === "ArrowUp") next = Math.max(current - 1, 0);
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = items.length - 1;
        e.preventDefault();
        items[next]?.focus();
    }, []);

    return {
        activePage,
        setActivePage,
        anchor,
        clearAnchor,
        openedFromHash,
        onNavKeyDown,
    };
}
