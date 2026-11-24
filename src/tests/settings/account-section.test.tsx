/**
 * @vitest-environment jsdom
 *
 * Settings › Account: name saves through Better Auth, the password form
 * checks the new password before asking the server and maps its errors
 * to the right field, and the email is read-only unless the instance
 * can send the confirmation.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh, push: vi.fn(), prefetch: vi.fn() }),
}));

const updateUser = vi.fn();
const changePassword = vi.fn();
const changeEmail = vi.fn();
const revokeOtherSessions = vi.fn();
vi.mock("@/lib/auth-client", () => ({
    authClient: {
        updateUser: (...args: unknown[]) => updateUser(...args),
        changePassword: (...args: unknown[]) => changePassword(...args),
        changeEmail: (...args: unknown[]) => changeEmail(...args),
        revokeOtherSessions: (...args: unknown[]) =>
            revokeOtherSessions(...args),
    },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
    toast: {
        success: (...args: unknown[]) => toastSuccess(...args),
        error: (...args: unknown[]) => toastError(...args),
    },
}));

import {
    AccountSection,
    newPasswordError,
} from "@/components/settings-sections/account-section";

const ACCOUNT = { name: "Maya Reed", email: "maya@example.com" };

function renderAccount(
    opts: { canChangeEmail?: boolean; isHosted?: boolean } = {},
) {
    const onNavigate = vi.fn();
    render(
        <AccountSection
            account={ACCOUNT}
            canChangeEmail={opts.canChangeEmail ?? false}
            isHosted={opts.isHosted ?? false}
            onNavigate={onNavigate}
        />,
    );
    return { onNavigate };
}

beforeEach(() => {
    // Radix Switch measures its thumb.
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    updateUser.mockResolvedValue({ data: { status: true }, error: null });
    changePassword.mockResolvedValue({ data: {}, error: null });
    changeEmail.mockResolvedValue({ data: { status: true }, error: null });
    revokeOtherSessions.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("name", () => {
    it("saves a changed name on Enter", async () => {
        renderAccount();
        const input = screen.getByLabelText("Name");
        fireEvent.change(input, { target: { value: "  Maya R. " } });
        fireEvent.keyDown(input, { key: "Enter" });
        await vi.waitFor(() =>
            expect(updateUser).toHaveBeenCalledWith({ name: "Maya R." }),
        );
        await vi.waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith("Name saved"),
        );
        expect(refresh).toHaveBeenCalled();
    });

    it("doesn't save an unchanged name", () => {
        renderAccount();
        fireEvent.blur(screen.getByLabelText("Name"));
        expect(updateUser).not.toHaveBeenCalled();
    });

    it("explains an empty name under the field instead of saving it", async () => {
        renderAccount();
        const input = screen.getByLabelText("Name");
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.blur(input);
        expect(
            await screen.findByText(
                "Enter a name. It's shown in the account menu",
            ),
        ).not.toBeNull();
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(updateUser).not.toHaveBeenCalled();
    });
});

describe("password", () => {
    it("words the length rule with the count", () => {
        expect(newPasswordError("")).toBe("Enter a new password");
        expect(newPasswordError("abc123")).toBe(
            "Use at least 8 characters. This one has 6",
        );
        expect(newPasswordError("long enough")).toBeNull();
    });

    it("stays collapsed behind one button until asked", () => {
        renderAccount();
        expect(screen.queryByLabelText("Current password")).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: "Change password" }),
        );
        expect(screen.getByLabelText("Current password")).not.toBeNull();
    });

    it("checks the fields before asking the server", async () => {
        renderAccount();
        fireEvent.click(
            screen.getByRole("button", { name: "Change password" }),
        );
        fireEvent.change(screen.getByLabelText("New password"), {
            target: { value: "short" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save password" }));
        expect(
            await screen.findByText("Enter your current password"),
        ).not.toBeNull();
        expect(
            screen.getByText("Use at least 8 characters. This one has 5"),
        ).not.toBeNull();
        expect(changePassword).not.toHaveBeenCalled();
    });

    it("signs out other devices by default and reports success", async () => {
        renderAccount();
        fireEvent.click(
            screen.getByRole("button", { name: "Change password" }),
        );
        fireEvent.change(screen.getByLabelText("Current password"), {
            target: { value: "old-password" },
        });
        fireEvent.change(screen.getByLabelText("New password"), {
            target: { value: "new-password-1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save password" }));
        await vi.waitFor(() =>
            expect(changePassword).toHaveBeenCalledWith({
                currentPassword: "old-password",
                newPassword: "new-password-1",
                revokeOtherSessions: true,
            }),
        );
        await vi.waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith(
                "Password changed. Other devices are signed out",
            ),
        );
        await vi.waitFor(() =>
            expect(screen.queryByLabelText("Current password")).toBeNull(),
        );
    });

    it("puts a wrong current password under that field", async () => {
        changePassword.mockResolvedValue({
            data: null,
            error: { code: "INVALID_PASSWORD", message: "Invalid password" },
        });
        renderAccount();
        fireEvent.click(
            screen.getByRole("button", { name: "Change password" }),
        );
        fireEvent.change(screen.getByLabelText("Current password"), {
            target: { value: "wrong-password" },
        });
        fireEvent.change(screen.getByLabelText("New password"), {
            target: { value: "new-password-1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save password" }));
        expect(
            await screen.findByText("That isn't your current password"),
        ).not.toBeNull();
        expect(
            screen
                .getByLabelText("Current password")
                .getAttribute("aria-invalid"),
        ).toBe("true");
    });
});

describe("email", () => {
    it("is read-only when the instance can't send the confirmation", () => {
        renderAccount({ canChangeEmail: false });
        expect(screen.getByText("maya@example.com")).not.toBeNull();
        expect(screen.getByText("You sign in with it")).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    });

    it("offers Change where the confirmation can be sent", async () => {
        renderAccount({ canChangeEmail: true });
        fireEvent.click(screen.getByRole("button", { name: "Change" }));
        fireEvent.change(screen.getByLabelText("New email"), {
            target: { value: "Maya@Reedstudio.com" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Send confirmation" }),
        );
        await vi.waitFor(() =>
            expect(changeEmail).toHaveBeenCalledWith({
                newEmail: "maya@reedstudio.com",
                callbackURL: `${window.location.origin}/settings#account`,
            }),
        );
        expect(
            await screen.findByText(/Approve the change from maya@example.com/),
        ).not.toBeNull();
    });
});

describe("other devices and delete", () => {
    it("signs out every other session", async () => {
        renderAccount();
        fireEvent.click(
            screen.getByRole("button", { name: "Sign out other devices" }),
        );
        await vi.waitFor(() => expect(revokeOtherSessions).toHaveBeenCalled());
        await vi.waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith(
                "Signed out of every other device",
            ),
        );
    });

    it("links to Plan & usage for deleting, on hosted only", () => {
        const { onNavigate } = renderAccount({ isHosted: true });
        fireEvent.click(
            screen.getByRole("button", { name: "Open Plan & usage" }),
        );
        expect(onNavigate).toHaveBeenCalledWith("plan");
        cleanup();
        renderAccount({ isHosted: false });
        expect(
            screen.queryByRole("heading", { name: "Delete account" }),
        ).toBeNull();
    });
});
