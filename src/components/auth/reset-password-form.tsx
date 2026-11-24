"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import {
    AUTH_ERROR_COPY,
    MIN_PASSWORD_LENGTH,
    mapAuthError,
    passwordTooShortMessage,
} from "@/components/auth/auth-errors";
import { AuthHeading, AuthLink } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { resetPassword } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

interface ResetPasswordFormProps {
    /**
     * `set` when the link carried a valid token, `invalid` when it is
     * missing or Better Auth flagged it (from `resetPasswordMode()` in
     * `@/lib/auth/reset-password-mode`).
     */
    mode: "set" | "invalid";
    /**
     * Reset token from the email link. Better Auth's GET
     * `/reset-password/:token` validates it, then redirects here with
     * `?token=VALID_TOKEN` or `?error=INVALID_TOKEN` (expired or used).
     */
    token?: string;
    error?: string;
}

interface ResetErrors {
    password?: ReactNode;
    confirmPassword?: ReactNode;
    form?: ReactNode;
}

/** New-password form, or the expired-link state with "Send a new link". */
export function ResetPasswordForm({
    mode,
    token,
    error,
}: ResetPasswordFormProps) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<ResetErrors>({});
    const [tokenRejected, setTokenRejected] = useState(false);
    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);
    const { push } = useRouter();

    if (mode === "invalid" || !token || tokenRejected) {
        const expired =
            tokenRejected || error?.toUpperCase() === "INVALID_TOKEN";
        return <LinkNotUsable expired={expired} />;
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (password.length < MIN_PASSWORD_LENGTH) {
            setErrors({ password: passwordTooShortMessage(password.length) });
            passwordRef.current?.focus();
            return;
        }
        if (password !== confirmPassword) {
            setErrors({ confirmPassword: AUTH_ERROR_COPY.passwordsDontMatch });
            confirmRef.current?.focus();
            return;
        }
        setErrors({});
        setIsLoading(true);

        try {
            const result = await resetPassword({
                newPassword: password,
                token,
            });

            if (result.error) {
                const { kind } = mapAuthError(result.error);
                if (kind === "invalid-token") {
                    setTokenRejected(true);
                } else if (kind === "password-too-short") {
                    setErrors({
                        password: passwordTooShortMessage(password.length),
                    });
                    passwordRef.current?.focus();
                } else if (kind === "password-too-long") {
                    setErrors({ password: AUTH_ERROR_COPY.passwordTooLong });
                    passwordRef.current?.focus();
                } else if (kind === "rate-limited") {
                    setErrors({ form: AUTH_ERROR_COPY.rateLimited });
                } else {
                    setErrors({
                        form:
                            result.error.message ||
                            "Couldn't save your password. Try again",
                    });
                }
                return;
            }

            toast.success("Password changed. Sign in with your new one");
            push("/login");
        } catch {
            setErrors({ form: AUTH_ERROR_COPY.network });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <AuthHeading title="Set a new password" tone="quiet">
                Pick one you don't use anywhere else
            </AuthHeading>
            <form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-4"
            >
                <Field
                    label="New password"
                    hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    error={errors.password}
                >
                    <FieldInput
                        ref={passwordRef}
                        type="password"
                        name="password"
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (errors.password || errors.form) setErrors({});
                        }}
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                    />
                </Field>
                <Field label="Confirm password" error={errors.confirmPassword}>
                    <FieldInput
                        ref={confirmRef}
                        type="password"
                        name="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (errors.confirmPassword || errors.form) {
                                setErrors({});
                            }
                        }}
                        required
                        autoComplete="new-password"
                    />
                </Field>
                <div className="flex flex-col gap-3 pt-2">
                    {errors.form ? (
                        <FieldError role="alert">{errors.form}</FieldError>
                    ) : null}
                    <Button
                        type="submit"
                        variant="ink"
                        size="control"
                        className="w-full"
                        disabled={isLoading}
                    >
                        {isLoading ? "Saving…" : "Save password"}
                    </Button>
                    <p className="text-center text-small text-muted-foreground">
                        This signs you out on your other devices
                    </p>
                </div>
            </form>
            <div className="flex justify-center">
                <AuthLink href="/login">Back to sign in</AuthLink>
            </div>
        </>
    );
}

/** An expired, used or incomplete reset link. */
function LinkNotUsable({ expired }: { expired: boolean }) {
    return (
        <>
            <AuthHeading
                title={
                    expired ? "This link has expired" : "Reset link incomplete"
                }
            >
                {expired
                    ? "Reset links work once, for 1 hour. Ask for a new one, then use the link in the newest email."
                    : "Open the newest reset email, or ask for a new link."}
            </AuthHeading>
            <Button asChild variant="ink" size="control" className="w-full">
                <Link href="/forgot-password">Send a new link</Link>
            </Button>
            <div className="flex justify-center">
                <AuthLink href="/login">Back to sign in</AuthLink>
            </div>
        </>
    );
}
