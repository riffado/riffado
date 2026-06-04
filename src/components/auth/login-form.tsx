"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

interface LoginFormProps {
    registrationEnabled?: boolean;
    smtpConfigured?: boolean;
}

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
            const result = await signIn.email({ email, password });

            if (result.error) {
                toast.error(result.error.message || "Invalid email or password");
                return;
            }

            toast.success("Logged in successfully");
            push("/dashboard");
            refresh();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Invalid email or password";
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm font-medium">
                        Email
                    </Label>
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

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-sm font-medium">
                            Password
                        </Label>
                        {smtpConfigured && (
                            <Link
                                href="/forgot-password"
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                            >
                                Forgot password?
                            </Link>
                        )}
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

                <Button
                    type="submit"
                    className="w-full"
                    variant="glow"
                    disabled={isLoading}
                >
                    {isLoading ? "Signing in…" : "Sign in"}
                </Button>
            </form>

            {registrationEnabled && (
                <p className="text-center text-sm text-muted-foreground">
                    Don't have an account?{" "}
                    <Link
                        href="/register"
                        className="text-foreground font-medium hover:underline underline-offset-2 transition-colors"
                    >
                        Register
                    </Link>
                </p>
            )}
        </div>
    );
}
