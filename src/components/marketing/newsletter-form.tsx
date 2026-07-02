"use client";

import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status =
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "success" }
    | { kind: "error"; message: string };

interface NewsletterFormProps {
    source?: "landing" | "install" | "admin";
    placeholder?: string;
    submitLabel?: string;
}

export function NewsletterForm({
    source = "landing",
    placeholder = "you@example.com",
    submitLabel = "Subscribe",
}: NewsletterFormProps) {
    const [email, setEmail] = useState("");
    const [company, setCompany] = useState("");
    const [status, setStatus] = useState<Status>({ kind: "idle" });

    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (status.kind === "submitting" || status.kind === "success") return;

        const trimmed = email.trim();
        if (!trimmed) {
            setStatus({
                kind: "error",
                message: "Please enter an email address.",
            });
            return;
        }

        setStatus({ kind: "submitting" });
        try {
            const response = await fetch("/api/newsletter/subscribe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    email: trimmed,
                    company,
                    source,
                }),
            });

            if (response.status === 429) {
                setStatus({
                    kind: "error",
                    message:
                        "Too many submissions from this network. Try again in a minute.",
                });
                return;
            }

            if (!response.ok) {
                let message = "Something went wrong. Please try again.";
                try {
                    const body = (await response.json()) as {
                        error?: unknown;
                    };
                    if (typeof body.error === "string") message = body.error;
                } catch {
                    // ignore
                }
                setStatus({ kind: "error", message });
                return;
            }

            setStatus({ kind: "success" });
        } catch (error) {
            console.error("Newsletter subscribe failed:", error);
            setStatus({
                kind: "error",
                message:
                    "Couldn't reach the server. Check your connection and try again.",
            });
        }
    };

    if (status.kind === "success") {
        return (
            <div
                className="rounded-md border border-border bg-muted/40 p-4 text-sm"
                aria-live="polite"
            >
                <p className="font-medium text-foreground">Check your email.</p>
                <p className="mt-1 text-muted-foreground">
                    We just sent a confirmation link to {email.trim()}. Click it
                    and you're subscribed.
                </p>
            </div>
        );
    }

    const isSubmitting = status.kind === "submitting";

    return (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    left: "-10000px",
                    width: "1px",
                    height: "1px",
                    overflow: "hidden",
                }}
            >
                <label htmlFor="newsletter-company">Company</label>
                <input
                    id="newsletter-company"
                    name="company"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    id="newsletter-email"
                    type="email"
                    placeholder={placeholder}
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting}
                    aria-label="Email address"
                    className="sm:flex-1"
                />
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <Loader2
                                className="size-4 animate-spin"
                                aria-hidden
                            />
                            Subscribing
                        </>
                    ) : (
                        submitLabel
                    )}
                </Button>
            </div>

            {status.kind === "error" ? (
                <p
                    className="text-sm text-destructive"
                    role="alert"
                    aria-live="polite"
                >
                    {status.message}
                </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
                Double-opt-in: you'll get a confirmation email and have to click
                the link before we ever send you anything else. Unsubscribe at
                any time.
            </p>
        </form>
    );
}
