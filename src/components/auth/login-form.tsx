"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

interface LoginFormProps {
    /**
     * Whether the "Don't have an account? Register" footer link should be
     * shown. Default `true`. Set to `false` when `DISABLE_REGISTRATION=true`
     * so we don't dangle a link to a disabled-state page. The server-side
     * security boundary lives in `src/lib/auth.ts` (`disableSignUp`); this
     * is UX only.
     */
    registrationEnabled?: boolean;
    /**
     * Whether SMTP is configured on this instance. When false we hide the
     * "Forgot password?" link entirely because the reset email cannot be
     * delivered -- end users shouldn't see a non-functional affordance on
     * the sign-in screen. Self-host operators get the explanatory panel
     * (with the SMTP env-var names) by navigating to /forgot-password
     * directly, which is also linked from the README.
     */
    smtpConfigured?: boolean;
}

/**
 * Renders only the form (fields + submit + optional register footer).
 * Page chrome (logo, headings, panel, background) is owned by the route.
 */
export function LoginForm({
    registrationEnabled = true,
    smtpConfigured = false,
}: LoginFormProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const { push, refresh } = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const result = await signIn.email({
                email,
                password,
            });

            if (result.error) {
                toast.error(
                    result.error.message || "Invalid email or password",
                );
                return;
            }

            toast.success("Logged in successfully");
            push("/dashboard");
            refresh();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Invalid email or password";
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
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
                        autoComplete="email"
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        {smtpConfigured ? (
                            <Link
                                href="/forgot-password"
                                className="text-xs text-muted-foreground hover:text-accent-cyan hover:underline"
                            >
                                Forgot password?
                            </Link>
                        ) : null}
                    </div>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                        autoComplete="current-password"
                    />
                </div>

                <MetalButton
                    type="submit"
                    className="w-full"
                    variant="cyan"
                    disabled={isLoading}
                >
                    {isLoading ? "Signing in..." : "Sign In"}
                </MetalButton>
            </form>

            {registrationEnabled && (
                <div className="text-center text-sm">
                    <span className="text-muted-foreground">
                        Don't have an account?{" "}
                    </span>
                    <Link
                        href="/register"
                        className="text-accent-cyan hover:underline"
                    >
                        Register
                    </Link>
                </div>
            )}
        </div>
    );
}
