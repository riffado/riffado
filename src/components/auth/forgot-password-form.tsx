"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/icons/logo";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgetPassword } from "@/lib/auth-client";

interface ForgotPasswordFormProps {
    /**
     * Whether SMTP is configured on this instance. When false the form is
     * disabled and we surface a hint pointing at the SMTP env vars rather
     * than letting the user submit a request that can't be delivered.
     */
    smtpConfigured: boolean;
}

export function ForgotPasswordForm({
    smtpConfigured,
}: ForgotPasswordFormProps) {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!smtpConfigured) return;
        setIsLoading(true);

        try {
            // We intentionally don't surface the better-auth response: we
            // always show the same success message so this endpoint can't
            // be used to enumerate which emails have accounts.
            await forgetPassword({
                email,
                redirectTo: "/reset-password",
            });
            setSubmitted(true);
        } catch (error) {
            // Network-level failures still get surfaced -- those aren't an
            // account-existence signal.
            const message =
                error instanceof Error
                    ? error.message
                    : "Could not send reset email. Please try again.";
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Panel className="w-full max-w-md space-y-6">
            <div className="flex items-center gap-3">
                <Logo className="size-10 shrink-0" />
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Reset password
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        We'll email you a link to set a new password.
                    </p>
                </div>
            </div>

            {!smtpConfigured ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-medium">
                        Password reset is unavailable on this instance.
                    </p>
                    <p className="text-muted-foreground">
                        The administrator hasn't configured SMTP, so reset
                        emails can't be delivered. Set{" "}
                        <code className="font-mono text-xs">SMTP_HOST</code>,{" "}
                        <code className="font-mono text-xs">SMTP_USER</code>,
                        and{" "}
                        <code className="font-mono text-xs">SMTP_PASSWORD</code>{" "}
                        in the server environment to enable it. In the meantime,
                        ask your administrator to reset your password directly
                        in the database.
                    </p>
                </div>
            ) : submitted ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-medium">Check your email.</p>
                    <p className="text-muted-foreground">
                        If an account exists for{" "}
                        <span className="font-mono text-xs">{email}</span>,
                        we've sent a password reset link. The link expires in 1
                        hour.
                    </p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={isLoading}
                        />
                    </div>

                    <MetalButton
                        type="submit"
                        className="w-full"
                        variant="cyan"
                        disabled={isLoading}
                    >
                        {isLoading ? "Sending..." : "Send reset link"}
                    </MetalButton>
                </form>
            )}

            <div className="text-center text-sm">
                <Link
                    href="/login"
                    className="text-accent-cyan hover:underline"
                >
                    Back to sign in
                </Link>
            </div>
        </Panel>
    );
}
