"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgetPassword } from "@/lib/auth-client";

interface ForgotPasswordFormProps {
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
            await forgetPassword({ email, redirectTo: "/reset-password" });
            setSubmitted(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Could not send reset email. Please try again.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const InfoBlock = ({ children }: { children: React.ReactNode }) => (
        <div className="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm dark:bg-muted/20">
            {children}
        </div>
    );

    return (
        <div className="space-y-5">
            {!smtpConfigured ? (
                <InfoBlock>
                    <p className="font-medium mb-1.5">
                        Password reset unavailable
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        SMTP isn't configured on this instance. Set{" "}
                        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                            SMTP_HOST
                        </code>
                        ,{" "}
                        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                            SMTP_USER
                        </code>
                        , and{" "}
                        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                            SMTP_PASSWORD
                        </code>{" "}
                        to enable it.
                    </p>
                </InfoBlock>
            ) : submitted ? (
                <InfoBlock>
                    <p className="font-medium mb-1.5">Check your inbox</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        If an account exists for{" "}
                        <span className="font-mono text-xs">{email}</span>,
                        we've sent a reset link. It expires in 1 hour.
                    </p>
                </InfoBlock>
            ) : (
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
                    <Button
                        type="submit"
                        className="w-full"
                        variant="glow"
                        disabled={isLoading}
                    >
                        {isLoading ? "Sending…" : "Send reset link"}
                    </Button>
                </form>
            )}
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
