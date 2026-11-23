"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

/** Outline "Sign out" button that ends the session and opens sign-in. */
export function SignOutButton() {
    const [pending, setPending] = useState(false);
    const { push, refresh } = useRouter();

    const handleSignOut = async () => {
        setPending(true);
        try {
            const result = await signOut();
            if (result.error) throw new Error(result.error.message);
            if (posthog.__loaded) {
                posthog.capture("user_signed_out");
                posthog.reset();
            }
            push("/login");
            refresh();
        } catch {
            toast.error("Couldn't sign out. Try again");
            setPending(false);
        }
    };

    return (
        <Button
            type="button"
            variant="bordered"
            size="control"
            onClick={handleSignOut}
            disabled={pending}
        >
            {pending ? "Signing out…" : "Sign out"}
        </Button>
    );
}
