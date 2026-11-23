/**
 * @vitest-environment jsdom
 *
 * Sign in, create account and password reset show their errors under the
 * field they belong to (tied with aria-describedby), never as toasts.
 * Forgot password always explains itself, with or without email on the
 * server.
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

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
    useRouter: () => router,
}));

const authClient = vi.hoisted(() => ({
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendVerificationEmail: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => authClient);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

import {
    AUTH_ERROR_COPY,
    mapAuthError,
    passwordTooShortMessage,
} from "@/components/auth/auth-errors";
import {
    ForgotPasswordForm,
    SMTP_ENV_VARS,
} from "@/components/auth/forgot-password-form";
import { LoginForm } from "@/components/auth/login-form";
import {
    POST_SIGN_UP_URL,
    RegisterForm,
} from "@/components/auth/register-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

function type(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: string | RegExp) {
    return act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
    });
}

/** The text an input's aria-describedby points at, or null. */
function descriptionOf(input: HTMLElement): string | null {
    const id = input.getAttribute("aria-describedby");
    if (!id) return null;
    return document.getElementById(id)?.textContent ?? null;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

describe("mapAuthError", () => {
    it("routes Better Auth codes to the field they belong to", () => {
        expect(mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toEqual({
            kind: "credentials",
            target: "password",
        });
        expect(
            mapAuthError({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }),
        ).toEqual({ kind: "email-taken", target: "email" });
        expect(mapAuthError({ code: "PASSWORD_TOO_SHORT" }).target).toBe(
            "password",
        );
        expect(mapAuthError({ code: "INVALID_TOKEN" }).kind).toBe(
            "invalid-token",
        );
    });

    it("treats a 429 as a form-level rate limit whatever the code", () => {
        expect(
            mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD", status: 429 }),
        ).toEqual({ kind: "rate-limited", target: "form" });
    });

    it("falls back to a form-level error for unknown codes", () => {
        expect(mapAuthError({ code: "SOMETHING_NEW" })).toEqual({
            kind: "unknown",
            target: "form",
        });
    });
});

describe("Sign in", () => {
    it("shows one message under the password for a wrong email or password", async () => {
        authClient.signIn.email.mockResolvedValue({
            error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
        });
        render(<LoginForm />);
        type("Email", "maya@example.com");
        type("Password", "wrong-password");
        await submit("Sign in");

        const password = screen.getByLabelText("Password");
        expect(password.getAttribute("aria-invalid")).toBe("true");
        expect(descriptionOf(password)).toBe(
            "That email and password don't match. Try again or reset your password",
        );
        expect(
            screen
                .getByRole("link", { name: "reset your password" })
                .getAttribute("href"),
        ).toBe("/forgot-password");
        expect(
            screen.getByLabelText("Email").getAttribute("aria-invalid"),
        ).toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });

    it("clears the error once the password changes", async () => {
        authClient.signIn.email.mockResolvedValue({
            error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
        });
        render(<LoginForm />);
        type("Email", "maya@example.com");
        type("Password", "wrong-password");
        await submit("Sign in");
        type("Password", "another-try");

        expect(
            screen.getByLabelText("Password").getAttribute("aria-invalid"),
        ).toBeNull();
        expect(screen.queryByText(/don't match/)).toBeNull();
    });

    it("shows a rate limit above the button, not under a field", async () => {
        authClient.signIn.email.mockResolvedValue({
            error: { status: 429, message: "Too many requests" },
        });
        render(<LoginForm />);
        type("Email", "maya@example.com");
        type("Password", "password-123");
        await submit("Sign in");

        expect(screen.getByRole("alert").textContent).toBe(
            AUTH_ERROR_COPY.rateLimited,
        );
        expect(
            screen.getByLabelText("Password").getAttribute("aria-invalid"),
        ).toBeNull();
    });

    it("asks for a missing email without calling the server", async () => {
        render(<LoginForm />);
        await submit("Sign in");

        expect(descriptionOf(screen.getByLabelText("Email"))).toBe(
            "Enter your email",
        );
        expect(authClient.signIn.email).not.toHaveBeenCalled();
    });

    it("opens the dashboard after signing in", async () => {
        authClient.signIn.email.mockResolvedValue({
            data: { user: { id: "user-1" } },
        });
        render(<LoginForm />);
        type("Email", "maya@example.com");
        type("Password", "password-123");
        await submit("Sign in");

        expect(router.push).toHaveBeenCalledWith("/dashboard");
    });

    it("always links to Forgot password, and says when sign-ups are off", () => {
        render(<LoginForm registrationEnabled={false} />);

        expect(
            screen
                .getByRole("link", { name: "Forgot password?" })
                .getAttribute("href"),
        ).toBe("/forgot-password");
        expect(
            screen.getByText("Sign-ups are turned off on this server"),
        ).not.toBeNull();
        expect(
            screen.queryByRole("link", { name: "Create an account" }),
        ).toBeNull();
    });

    it("shows Terms only when asked (hosted)", () => {
        const { rerender } = render(<LoginForm />);
        expect(screen.queryByRole("link", { name: "Terms" })).toBeNull();
        rerender(<LoginForm showTerms />);
        expect(screen.getByRole("link", { name: "Terms" })).not.toBeNull();
    });
});

describe("Create account", () => {
    function fillForm(password = "long-enough-1", confirm = password) {
        type("Name", "Maya Reed");
        type("Email", "maya@example.com");
        type("Password", password);
        type("Confirm password", confirm);
    }

    it("turns the password hint into the error in place", async () => {
        render(<RegisterForm requireEmailVerification={false} />);
        const password = screen.getByLabelText("Password");
        expect(descriptionOf(password)).toBe("At least 8 characters");

        fillForm("short1");
        await submit("Create account");

        expect(descriptionOf(password)).toBe(passwordTooShortMessage(6));
        expect(passwordTooShortMessage(6)).toBe(
            "Use at least 8 characters. This one has 6",
        );
        expect(password.getAttribute("aria-invalid")).toBe("true");
        expect(screen.queryByText("At least 8 characters")).toBeNull();
        expect(authClient.signUp.email).not.toHaveBeenCalled();
    });

    it("flags a confirm password that doesn't match", async () => {
        render(<RegisterForm requireEmailVerification={false} />);
        fillForm("long-enough-1", "long-enough-2");
        await submit("Create account");

        expect(descriptionOf(screen.getByLabelText("Confirm password"))).toBe(
            AUTH_ERROR_COPY.passwordsDontMatch,
        );
        expect(authClient.signUp.email).not.toHaveBeenCalled();
    });

    it("puts an email that's already used under the email field", async () => {
        authClient.signUp.email.mockResolvedValue({
            error: {
                code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
                status: 422,
            },
        });
        render(<RegisterForm requireEmailVerification={false} />);
        fillForm();
        await submit("Create account");

        const email = screen.getByLabelText("Email");
        expect(descriptionOf(email)).toBe(
            "There's already an account with this email. Sign in instead",
        );
        expect(email.getAttribute("aria-invalid")).toBe("true");
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("lands a new account on the first-run screen with the welcome flag", async () => {
        authClient.signUp.email.mockResolvedValue({
            data: { user: { id: "user-1" } },
        });
        render(<RegisterForm requireEmailVerification={false} />);
        fillForm();
        await submit("Create account");

        expect(authClient.signUp.email).toHaveBeenCalledWith(
            expect.objectContaining({ callbackURL: POST_SIGN_UP_URL }),
        );
        expect(router.push).toHaveBeenCalledWith("/dashboard?welcome=1");
    });

    it("shows Check your email when the instance verifies email", async () => {
        authClient.signUp.email.mockResolvedValue({
            data: { user: { id: "user-1" } },
        });
        render(<RegisterForm requireEmailVerification />);
        fillForm();
        await submit("Create account");

        expect(
            screen.getByRole("heading", { name: "Check your email" }),
        ).not.toBeNull();
        expect(screen.getByText(/Open it within 24 hours/)).not.toBeNull();
        const resend = screen.getByRole("button", { name: /Resend email/ });
        expect((resend as HTMLButtonElement).disabled).toBe(true);
        expect(router.push).not.toHaveBeenCalled();
    });
});

describe("Forgot password", () => {
    it("sends the reset link and shows the same answer for any email", async () => {
        authClient.requestPasswordReset.mockResolvedValue({ data: {} });
        render(<ForgotPasswordForm smtpConfigured />);
        type("Email", "maya@example.com");
        await submit("Send reset link");

        expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
            email: "maya@example.com",
            redirectTo: "/reset-password",
        });
        expect(
            screen.getByRole("heading", { name: "Check your email" }),
        ).not.toBeNull();
        expect(
            screen.getByText(/a reset link is on its way. It works for 1 hour/),
        ).not.toBeNull();
    });

    it("reports a rate limit instead of claiming the email went out", async () => {
        authClient.requestPasswordReset.mockResolvedValue({
            error: { status: 429 },
        });
        render(<ForgotPasswordForm smtpConfigured />);
        type("Email", "maya@example.com");
        await submit("Send reset link");

        expect(screen.getByRole("alert").textContent).toBe(
            AUTH_ERROR_COPY.rateLimited,
        );
        expect(
            screen.queryByRole("heading", { name: "Check your email" }),
        ).toBeNull();
    });

    it("without email on the server, says who to ask and names the SMTP vars", () => {
        render(<ForgotPasswordForm smtpConfigured={false} />);

        expect(
            screen.getByText(
                /Ask the person who runs it to reset your password/,
            ),
        ).not.toBeNull();
        expect(screen.queryByLabelText("Email")).toBeNull();
        const operator = screen
            .getByRole("heading", { name: "If you run this server" })
            .closest("section");
        if (!operator) throw new Error("Operator block not found");
        for (const name of SMTP_ENV_VARS) {
            expect(within(operator).getByText(name)).not.toBeNull();
        }
        expect(SMTP_ENV_VARS).toEqual([
            "SMTP_HOST",
            "SMTP_USER",
            "SMTP_PASSWORD",
        ]);
        expect(document.body.textContent).not.toMatch(/database/i);
        expect(
            screen
                .getByRole("link", { name: "Back to sign in" })
                .getAttribute("href"),
        ).toBe("/login");
    });
});

describe("Reset password", () => {
    it("explains an expired link and offers a new one", () => {
        render(<ResetPasswordForm mode="invalid" error="INVALID_TOKEN" />);

        expect(
            screen.getByRole("heading", { name: "This link has expired" }),
        ).not.toBeNull();
        expect(
            screen
                .getByRole("link", { name: "Send a new link" })
                .getAttribute("href"),
        ).toBe("/forgot-password");
    });

    it("explains a link without a token", () => {
        render(<ResetPasswordForm mode="invalid" />);

        expect(
            screen.getByText(
                "Open the newest reset email, or ask for a new link.",
            ),
        ).not.toBeNull();
    });

    it("shows a short password under the new-password field", async () => {
        render(<ResetPasswordForm mode="set" token="tok" />);
        type("New password", "short");
        type("Confirm password", "short");
        await submit("Save password");

        expect(descriptionOf(screen.getByLabelText("New password"))).toBe(
            passwordTooShortMessage(5),
        );
        expect(authClient.resetPassword).not.toHaveBeenCalled();
    });

    it("switches to the expired state when the server rejects the token", async () => {
        authClient.resetPassword.mockResolvedValue({
            error: { code: "INVALID_TOKEN", status: 400 },
        });
        render(<ResetPasswordForm mode="set" token="tok" />);
        type("New password", "long-enough-1");
        type("Confirm password", "long-enough-1");
        await submit("Save password");

        expect(
            screen.getByRole("heading", { name: "This link has expired" }),
        ).not.toBeNull();
    });

    it("sends the user to sign in with a toast once the password is saved", async () => {
        authClient.resetPassword.mockResolvedValue({ data: { status: true } });
        render(<ResetPasswordForm mode="set" token="tok" />);
        type("New password", "long-enough-1");
        type("Confirm password", "long-enough-1");
        await submit("Save password");

        expect(authClient.resetPassword).toHaveBeenCalledWith({
            newPassword: "long-enough-1",
            token: "tok",
        });
        expect(toast.success).toHaveBeenCalledWith(
            "Password changed. Sign in with your new one",
        );
        expect(router.push).toHaveBeenCalledWith("/login");
    });
});
