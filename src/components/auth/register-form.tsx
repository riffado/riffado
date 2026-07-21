"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendVerificationEmail, signUp } from "@/lib/auth-client";

const RESEND_COOLDOWN_MS = 30_000;

interface RegisterFormProps {
    /**
     * Whether the instance requires email verification before sign-in
     * (`emailVerificationRequired` in `src/lib/auth.ts` -- hosted + SMTP
     * configured only). When true, `signUp.email()` creates the user but
     * does not create a session, so we can't redirect into the app; we
     * show an in-place "check your email" panel instead.
     */
    requireEmailVerification: boolean;
}

/**
 * Renders only the form (fields + submit + sign-in footer).
 * Page chrome (logo, headings, panel, background) is owned by the route.
 */
export function RegisterForm({ requireEmailVerification }: RegisterFormProps) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [awaitingVerification, setAwaitingVerification] = useState(false);
    const [lastResentAt, setLastResentAt] = useState(0);
    const [isResending, setIsResending] = useState(false);
    const { push, refresh } = useRouter();

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
            const result = await signUp.email({
                email,
                password,
                name,
                // Where the auto-sign-in-after-verification redirect lands the
                // user once they click the emailed link -- matches the
                // destination used when verification is off, so both paths
                // funnel through onboarding (Plaud connection) the same way.
                callbackURL: "/onboarding",
            });

            if (result.error) {
                toast.error(result.error.message || "Failed to create account");
                return;
            }

            if (requireEmailVerification) {
                setLastResentAt(Date.now());
                setAwaitingVerification(true);
                return;
            }

            toast.success("Account created successfully");
            push("/onboarding");
            refresh();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to create account";
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResend = async () => {
        const now = Date.now();
        if (now - lastResentAt < RESEND_COOLDOWN_MS) {
            const secs = Math.ceil(
                (RESEND_COOLDOWN_MS - (now - lastResentAt)) / 1000,
            );
            toast.error(`Please wait ${secs}s before resending`);
            return;
        }

        setIsResending(true);
        try {
            const result = await sendVerificationEmail({
                email,
                callbackURL: "/onboarding",
            });

            if (result.error) {
                toast.error(
                    result.error.message ||
                        "Failed to resend verification email",
                );
                return;
            }

            setLastResentAt(Date.now());
            toast.success("Verification email resent");
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to resend verification email";
            toast.error(message);
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="space-y-6">
            {awaitingVerification ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-medium">Check your email.</p>
                    <p className="text-muted-foreground">
                        We sent a verification link to{" "}
                        <span className="font-mono text-xs">{email}</span>.
                        Click the link to activate your account -- you won't be
                        able to sign in until it's verified.
                    </p>
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={isResending}
                        className="text-accent-cyan hover:underline disabled:opacity-50"
                    >
                        {isResending ? "Resending..." : "Resend email"}
                    </button>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            type="text"
                            placeholder="John Doe"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            disabled={isLoading}
                            autoComplete="name"
                        />
                    </div>

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
                            autoComplete="email"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
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
                        <Label htmlFor="confirmPassword">
                            Confirm Password
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

                    <MetalButton
                        type="submit"
                        className="w-full"
                        variant="cyan"
                        disabled={isLoading}
                    >
                        {isLoading ? "Creating account..." : "Create Account"}
                    </MetalButton>
                </form>
            )}

            <div className="text-center text-sm">
                <span className="text-muted-foreground">
                    Already have an account?{" "}
                </span>
                <Link
                    href="/login"
                    className="text-accent-cyan hover:underline"
                >
                    Sign in
                </Link>
            </div>
        </div>
    );
}
