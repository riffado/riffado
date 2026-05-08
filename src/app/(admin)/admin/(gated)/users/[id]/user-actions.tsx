"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Operator action panel. Each button opens a small confirm flow that requires
 * a written reason and submits to the corresponding /api/admin/actions/*
 * endpoint. The endpoint enforces the elevated-cookie mutation TTL again
 * server-side -- the UI is just convenience.
 */
export function UserActions({
    userId,
    suspended,
    plaudConnected,
}: {
    userId: string;
    suspended: boolean;
    plaudConnected: boolean;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);

    async function run(
        label: string,
        endpoint: string,
        promptMsg: string,
    ): Promise<void> {
        const reason = window.prompt(promptMsg);
        if (!reason || reason.trim().length < 4) {
            toast.error("Reason required (min 4 chars)");
            return;
        }
        setBusy(label);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ userId, reason }),
            });
            if (res.status === 404) {
                toast.error("Admin session expired. Reauth and try again.");
                router.replace(`/admin/reauth?next=/admin/users/${userId}`);
                return;
            }
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error ?? `Action failed (${res.status})`);
                return;
            }
            toast.success(`${label} done`);
            router.refresh();
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-wrap gap-2">
            {suspended ? (
                <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                        run(
                            "Unsuspend",
                            "/api/admin/actions/unsuspend",
                            "Reason for unsuspending this user:",
                        )
                    }
                >
                    {busy === "Unsuspend" ? "Working..." : "Unsuspend user"}
                </Button>
            ) : (
                <Button
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() =>
                        run(
                            "Suspend",
                            "/api/admin/actions/suspend",
                            "Reason for suspending this user:",
                        )
                    }
                >
                    {busy === "Suspend" ? "Working..." : "Suspend user"}
                </Button>
            )}
            <Button
                variant="outline"
                disabled={busy !== null || !plaudConnected}
                onClick={() =>
                    run(
                        "Disconnect Plaud",
                        "/api/admin/actions/disconnect-plaud",
                        "Reason for force-disconnecting this user's Plaud connection:",
                    )
                }
            >
                {busy === "Disconnect Plaud"
                    ? "Working..."
                    : "Force-disconnect Plaud"}
            </Button>
        </div>
    );
}
