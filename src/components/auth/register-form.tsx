"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendVerificationEmail, signUp } from "@/lib/auth-client";
import { uiText } from "@/lib/i18n";
import { uiError } from "@/lib/i18n/errors";

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
            toast.error(uiText("Passwords do not match"));
            return;
        }

        if (password.length < 8) {
            toast.error(uiText("Password must be at least 8 characters"));
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
                // destination used when verification is off. The mandatory
                // OnboardingDialog (Workstation) takes over from here for
                // any account that hasn't finished onboarding yet.
                callbackURL: "/dashboard",
            });

            if (result.error) {
                toast.error(
                    uiError(
                        result.error.message ||
                            uiText("Failed to create account"),
                        result.error.code,
                    ),
                );
                return;
            }

            if (requireEmailVerification) {
                setLastResentAt(Date.now());
                setAwaitingVerification(true);
                return;
            }

            if (posthog.__loaded && result.data?.user) {
                // Distinct id only -- see posthog-identify.tsx for why.
                posthog.identify(result.data.user.id);
                posthog.capture("user_signed_up");
            }

            toast.success(uiText("Account created successfully"));
            push("/dashboard");
            refresh();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : uiText("Failed to create account");
            toast.error(uiError(message));
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
            toast.error(
                uiText("Please wait {seconds}s before resending", {
                    seconds: secs,
                }),
            );
            return;
        }

        setIsResending(true);
        try {
            const result = await sendVerificationEmail({
                email,
                callbackURL: "/dashboard",
            });

            if (result.error) {
                toast.error(
                    uiError(
                        result.error.message ||
                            uiText("Failed to resend verification email"),
                        result.error.code,
                    ),
                );
                return;
            }

            setLastResentAt(Date.now());
            toast.success(uiText("Verification email resent"));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : uiText("Failed to resend verification email");
            toast.error(uiError(message));
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="space-y-6">
            {awaitingVerification ? (
                <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-medium">{uiText("Check your email.")}</p>
                    <p className="text-muted-foreground">
                        {uiText("We sent a verification link to")}{" "}
                        <span className="font-mono text-xs">{email}</span>
                        {uiText(
                            ". Click the link to activate your account -- you won't be able to sign in until it's verified.",
                        )}
                    </p>
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={isResending}
                        className="text-accent-cyan hover:underline disabled:opacity-50"
                    >
                        {isResending
                            ? uiText("Resending...")
                            : uiText("Resend email")}
                    </button>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">{uiText("Name")}</Label>
                        <Input
                            id="name"
                            type="text"
                            placeholder={uiText("John Doe")}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            disabled={isLoading}
                            autoComplete="name"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">{uiText("Email")}</Label>
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
                        <Label htmlFor="password">{uiText("Password")}</Label>
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
                            {uiText("Confirm Password")}
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
                        {isLoading
                            ? uiText("Creating account...")
                            : uiText("Create Account")}
                    </MetalButton>
                </form>
            )}

            <div className="text-center text-sm">
                <span className="text-muted-foreground">
                    {uiText("Already have an account?")}{" "}
                </span>
                <Link
                    href="/login"
                    className="text-accent-cyan hover:underline"
                >
                    {uiText("Sign in")}
                </Link>
            </div>
        </div>
    );
}
