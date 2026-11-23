/**
 * @vitest-environment jsdom
 *
 * The confirm dialog has no trigger of its own, so it hands focus back to
 * whatever opened it (H6): the element focused when `confirm()` ran, or
 * an explicit `returnFocusTo`.
 */

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmDialogProvider, useConfirm } from "@/components/confirm-dialog";

function Opener() {
    const confirm = useConfirm();
    return (
        <button
            type="button"
            onClick={() =>
                void confirm({
                    title: "Delete this recording?",
                    confirmLabel: "Delete recording",
                    onConfirm: () => {},
                })
            }
        >
            Row actions
        </button>
    );
}

afterEach(cleanup);

describe("confirm dialog focus", () => {
    it("returns focus to the opener after Cancel", async () => {
        render(
            <ConfirmDialogProvider>
                <Opener />
            </ConfirmDialogProvider>,
        );
        const opener = screen.getByRole("button", { name: "Row actions" });
        opener.focus();
        fireEvent.click(opener);

        const cancel = await screen.findByRole("button", { name: "Cancel" });
        fireEvent.click(cancel);

        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).toBeNull(),
        );
        expect(document.activeElement).toBe(opener);
    });

    it("returns focus to the opener after Escape", async () => {
        render(
            <ConfirmDialogProvider>
                <Opener />
            </ConfirmDialogProvider>,
        );
        const opener = screen.getByRole("button", { name: "Row actions" });
        opener.focus();
        fireEvent.click(opener);

        const dialog = await screen.findByRole("alertdialog");
        fireEvent.keyDown(dialog, { key: "Escape" });

        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).toBeNull(),
        );
        expect(document.activeElement).toBe(opener);
    });
});
