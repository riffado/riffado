"use client";

import { type FormEvent, useRef, useState } from "react";
import { AUTH_ERROR_COPY } from "@/components/auth/auth-errors";
import { AuthHeading, AuthLink } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { requestPasswordReset } from "@/lib/auth-client";

/**
 * The env vars `isSmtpConfigured()` (`src/lib/smtp.ts`) checks. Shown to
 * whoever runs the server when reset email can't be sent.
 */
export const SMTP_ENV_VARS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"];

interface ForgotPasswordFormProps {
    /**
     * Whether SMTP is configured on this instance. When false the form is
     * replaced by an explanation: ask whoever runs the server, plus a
     * separate block for them naming the env vars to set.
     */
    smtpConfigured: boolean;
}

/** Reset-password request: form, "Check your email", or no-email notice. */
export function ForgotPasswordForm({
    smtpConfigured,
}: ForgotPasswordFormProps) {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [emailError, setEmailError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const emailRef = useRef<HTMLInputElement>(null);

    if (!smtpConfigured) {
        return <EmailNotSetUp />;
    }

    if (submitted) {
        return (
            <>
                <AuthHeading title="Check your email">
                    If there's an account for{" "}
                    <span className="font-medium text-strong">{email}</span>, a
                    reset link is on its way. It works for 1 hour.
                </AuthHeading>
                <div className="flex">
                    <AuthLink href="/login">Back to sign in</AuthLink>
                </div>
            </>
        );
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim()) {
            setEmailError("Enter your email");
            emailRef.current?.focus();
            return;
        }
        setEmailError(null);
        setFormError(null);
        setIsLoading(true);

        try {
            // The response is deliberately ignored apart from rate limits:
            // every request shows the same "Check your email" so this page
            // can't be used to find out which emails have accounts.
            const result = await requestPasswordReset({
                email,
                redirectTo: "/reset-password",
            });
            // A 429 is a request-volume signal, not an account-existence
            // signal, so saying so leaks nothing.
            if (result?.error?.status === 429) {
                setFormError(AUTH_ERROR_COPY.rateLimited);
                return;
            }
            setSubmitted(true);
        } catch {
            setFormError(AUTH_ERROR_COPY.network);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <AuthHeading title="Reset password" tone="quiet">
                We'll email you a link to set a new one
            </AuthHeading>
            <form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-4"
            >
                <Field label="Email" error={emailError}>
                    <FieldInput
                        ref={emailRef}
                        type="email"
                        name="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            setEmailError(null);
                            setFormError(null);
                        }}
                        required
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                </Field>
                <div className="flex flex-col gap-3 pt-2">
                    {formError ? (
                        <FieldError role="alert">{formError}</FieldError>
                    ) : null}
                    <Button
                        type="submit"
                        variant="ink"
                        size="control"
                        className="w-full"
                        disabled={isLoading}
                    >
                        {isLoading ? "Sending…" : "Send reset link"}
                    </Button>
                </div>
            </form>
            <div className="flex justify-center">
                <AuthLink href="/login">Back to sign in</AuthLink>
            </div>
        </>
    );
}

/** Self-host without SMTP: who to ask, and what the operator sets. */
function EmailNotSetUp() {
    return (
        <>
            <AuthHeading title="Reset password">
                This server isn't set up to send email, so it can't send you a
                reset link. Ask the person who runs it to reset your password.
            </AuthHeading>
            <section
                aria-labelledby="smtp-operator-heading"
                className="squircle flex flex-col gap-3 rounded-[var(--radius-item)] border border-hairline bg-surface p-5"
            >
                <div className="flex flex-col gap-1">
                    <h2
                        id="smtp-operator-heading"
                        className="text-sm leading-5 font-medium text-strong"
                    >
                        If you run this server
                    </h2>
                    <p className="text-dialog-body text-subtle">
                        Add your email provider's SMTP details to the server's
                        environment, then restart Riffado
                    </p>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                    {SMTP_ENV_VARS.map((name) => (
                        <li key={name}>
                            <code className="flex h-7 items-center rounded-lg border border-hairline bg-reader px-2 font-mono text-small text-strong dark:bg-night-raised">
                                {name}
                            </code>
                        </li>
                    ))}
                </ul>
            </section>
            <div className="flex">
                <AuthLink href="/login">Back to sign in</AuthLink>
            </div>
        </>
    );
}
