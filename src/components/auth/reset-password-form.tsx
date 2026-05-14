"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/icons/logo";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";

interface ResetPasswordFormProps {
    /**
     * Reset token from the email link. better-auth's GET `/reset-password/:token`
     * endpoint validates the verification token, then redirects the browser to
     * the `callbackURL` we passed via `forgetPassword({ redirectTo })` with
     * either `?token=VALID_TOKEN` (success) or `?error=INVALID_TOKEN` (expired
     * or already-consumed). See better-auth `requestPasswordReset` source.
     */
    token?: string;
    error?: string;
}

export function ResetPasswordForm({ token, error }: ResetPasswordFormProps) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    // No token in URL, or better-auth signaled an error on the callback --
    // either the user navigated here directly, the token expired, or the
    // link was tampered with (e.g. crafted URL with both `token` and `error`).
    // Show an explanatory state rather than a form that's guaranteed to fail.
    if (!token || error) {
        return (
            <Panel className="w-full max-w-md space-y-6">
                <div className="flex items-center gap-3">
                    <Logo className="size-10 shrink-0" />
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Invalid reset link
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            This link is missing or has expired.
                        </p>
                    </div>
                </div>

                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    {error?.toUpperCase() === "INVALID_TOKEN" ? (
                        <p>
                            The reset link has expired or has already been used.
                            Request a new one to continue.
                        </p>
                    ) : (
                        <p>
                            Open the most recent reset email and click the link
                            from there, or request a new reset email.
                        </p>
                    )}
                </div>

                <div className="text-center text-sm">
                    <Link
                        href="/forgot-password"
                        className="text-accent-cyan hover:underline"
                    >
                        Request a new link
                    </Link>
                </div>
            </Panel>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }

        if (password.length < 8) {
            toast.error("Password must be at least 8 characters");
            return;
        }

        setIsLoading(true);

        try {
            const result = await resetPassword({
                newPassword: password,
                token,
            });

            if (result.error) {
                toast.error(
                    result.error.message ||
                        "Could not reset password. The link may have expired.",
                );
                return;
            }

            toast.success("Password reset. You can sign in now.");
            router.push("/login");
            router.refresh();
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Could not reset password. The link may have expired.";
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
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Set a new password
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Choose a password you don't use anywhere else.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="password">New password</Label>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                        minLength={8}
                        autoComplete="new-password"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm password</Label>
                    <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        disabled={isLoading}
                        autoComplete="new-password"
                    />
                </div>

                <MetalButton
                    type="submit"
                    className="w-full"
                    variant="cyan"
                    disabled={isLoading}
                >
                    {isLoading ? "Resetting..." : "Reset password"}
                </MetalButton>
            </form>

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
