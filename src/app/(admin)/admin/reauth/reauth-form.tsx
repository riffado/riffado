"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReauthForm({ email, next }: { email: string; next: string }) {
    const { refresh, replace } = useRouter();
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/admin/reauth", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (res.status === 404) {
                // Gate tripped (lost admin status, IP changed, etc.) -- bounce
                // to the user dashboard rather than reveal the route.
                replace("/dashboard");
                return;
            }
            if (!res.ok) {
                setError("Incorrect password");
                setSubmitting(false);
                return;
            }
            replace(next);
            refresh();
        } catch {
            setError("Something went wrong");
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div>
                <div className="text-xs text-muted-foreground mb-1">
                    Signed in as
                </div>
                <div className="text-sm font-medium">{email}</div>
            </div>
            <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- intentional -- admin re-auth modal is gated; the whole point of this page is to type a password
                autoFocus
            />
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            <Button type="submit" disabled={submitting || !password}>
                {submitting ? "Verifying..." : "Continue"}
            </Button>
        </form>
    );
}
