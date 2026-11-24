"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import {
    AUTH_ERROR_COPY,
    type AuthClientError,
    mapAuthError,
} from "@/components/auth/auth-errors";
import {
    AuthHeading,
    AuthSwitch,
    AuthTerms,
    ErrorLink,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { signIn } from "@/lib/auth-client";

interface LoginFormProps {
    /**
     * Whether the "Create an account" link is shown. False when
     * `DISABLE_REGISTRATION=true`; the page then says sign-ups are off.
     * The server-side boundary lives in `src/lib/auth.ts`
     * (`disableSignUp`); this is UX only.
     */
    registrationEnabled?: boolean;
    /** Shows the hosted Terms and Privacy line. */
    showTerms?: boolean;
}

interface LoginErrors {
    email?: ReactNode;
    password?: ReactNode;
    form?: ReactNode;
}

/** Sign-in heading, form and the links under it. */
export function LoginForm({
    registrationEnabled = true,
    showTerms = false,
}: LoginFormProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<LoginErrors>({});
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const { push, refresh } = useRouter();

    const showError = (error: AuthClientError) => {
        const { kind } = mapAuthError(error);
        switch (kind) {
            case "credentials":
                setErrors({
                    password: (
                        <>
                            That email and password don't match. Try again or{" "}
                            <ErrorLink href="/forgot-password">
                                reset your password
                            </ErrorLink>
                        </>
                    ),
                });
                passwordRef.current?.focus();
                return;
            case "email-not-verified":
                setErrors({ email: AUTH_ERROR_COPY.emailNotVerified });
                emailRef.current?.focus();
                return;
            case "invalid-email":
                setErrors({ email: AUTH_ERROR_COPY.invalidEmail });
                emailRef.current?.focus();
                return;
            case "rate-limited":
                setErrors({ form: AUTH_ERROR_COPY.rateLimited });
                return;
            default:
                setErrors({
                    form: error.message || "Couldn't sign in. Try again",
                });
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim()) {
            setErrors({ email: "Enter your email" });
            emailRef.current?.focus();
            return;
        }
        if (!password) {
            setErrors({ password: "Enter your password" });
            passwordRef.current?.focus();
            return;
        }
        setErrors({});
        setIsLoading(true);

        try {
            const result = await signIn.email({ email, password });

            if (result.error) {
                showError(result.error);
                return;
            }

            if (posthog.__loaded && result.data?.user) {
                // Distinct id only -- see posthog-identify.tsx for why.
                posthog.identify(result.data.user.id);
                posthog.capture("user_signed_in");
            }

            push("/dashboard");
            refresh();
        } catch {
            setErrors({ form: AUTH_ERROR_COPY.network });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <AuthHeading title="Sign in to Riffado" />
            <form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-4"
            >
                <Field label="Email" error={errors.email}>
                    <FieldInput
                        ref={emailRef}
                        type="email"
                        name="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            if (errors.email) setErrors({});
                        }}
                        required
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                </Field>

                <Field
                    label="Password"
                    labelAside={
                        <Link
                            href="/forgot-password"
                            className="rounded-sm text-small text-subtle outline-none hover:text-strong hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            Forgot password?
                        </Link>
                    }
                    error={errors.password}
                >
                    <FieldInput
                        ref={passwordRef}
                        type="password"
                        name="password"
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (errors.password) setErrors({});
                        }}
                        required
                        autoComplete="current-password"
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
                        {isLoading ? "Signing in…" : "Sign in"}
                    </Button>
                </div>
            </form>

            <div className="flex flex-col gap-5">
                {registrationEnabled ? (
                    <AuthSwitch prompt="New here?" href="/register">
                        Create an account
                    </AuthSwitch>
                ) : (
                    <p className="text-center text-sm text-muted-foreground">
                        {AUTH_ERROR_COPY.signUpDisabled}
                    </p>
                )}
                {showTerms ? <AuthTerms /> : null}
            </div>
        </>
    );
}
