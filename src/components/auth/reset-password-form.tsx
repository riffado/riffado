"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";

interface ResetPasswordFormProps {
    token?: string;
    error?: string;
}

export function resetPasswordMode(
    token: string | undefined,
    error: string | undefined,
): "set" | "invalid" {
    if (!token || error) return "invalid";
    return "set";
}

export function ResetPasswordForm({ token, error }: ResetPasswordFormProps) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const { push, refresh } = useRouter();

    if (resetPasswordMode(token, error) === "invalid") {
        return (
            <div className="space-y-5">
                <div className="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground dark:bg-muted/20 leading-relaxed">
                    {error?.toUpperCase() === "INVALID_TOKEN"
                        ? "The reset link has expired or has already been used. Request a new one to continue."
                        : "Open the most recent reset email and click the link from there, or request a new reset email."}
                </div>
                <p className="text-center text-sm">
                    <Link
                        href="/forgot-password"
                        className="text-foreground font-medium hover:underline underline-offset-2 transition-colors"
                    >
                        Request a new link
                    </Link>
                </p>
            </div>
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
            push("/login");
            refresh();
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Could not reset password.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-sm font-medium">
                        New password
                    </Label>
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
                <div className="space-y-1.5">
                    <Label
                        htmlFor="confirmPassword"
                        className="text-sm font-medium"
                    >
                        Confirm password
                    </Label>
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
                <Button
                    type="submit"
                    className="w-full"
                    variant="glow"
                    disabled={isLoading}
                >
                    {isLoading ? "Resetting…" : "Reset password"}
                </Button>
            </form>
            <p className="text-center text-sm">
                <Link
                    href="/login"
                    className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                >
                    ← Back to sign in
                </Link>
            </p>
        </div>
    );
}
