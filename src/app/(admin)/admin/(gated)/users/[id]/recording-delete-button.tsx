"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Per-row admin soft-delete. Does NOT hard-delete the audio blob -- the
 * regular user-initiated delete flow handles storage cleanup. This action
 * just sets the tombstone so the row stops appearing in user views and
 * stops counting toward quota. Ungated by mutation TTL (10m).
 */
export function RecordingDeleteButton({
    recordingId,
}: {
    recordingId: string;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    async function onClick() {
        const reason = window.prompt(
            "Reason for soft-deleting this recording (logged):",
        );
        if (!reason || reason.trim().length < 4) {
            toast.error("Reason required (min 4 chars)");
            return;
        }
        if (
            !window.confirm(
                "Soft-delete this recording? The user will no longer see it. Audio blob is retained.",
            )
        ) {
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(
                "/api/admin/actions/soft-delete-recording",
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ recordingId, reason }),
                },
            );
            if (res.status === 404) {
                toast.error("Admin session expired. Reauth and try again.");
                router.replace(
                    `/admin/reauth?next=${window.location.pathname}`,
                );
                return;
            }
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error ?? `Failed (${res.status})`);
                return;
            }
            toast.success("Recording soft-deleted");
            router.refresh();
        } finally {
            setBusy(false);
        }
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="text-xs px-2 py-1 border rounded hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-700 disabled:opacity-50 transition-colors"
        >
            {busy ? "..." : "Delete"}
        </button>
    );
}
