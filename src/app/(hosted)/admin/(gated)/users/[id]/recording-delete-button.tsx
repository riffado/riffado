"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

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
    const { refresh, replace } = useRouter();
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);

    function onClick() {
        // Reason input stays as a native prompt for now — our shared
        // confirm dialog is yes/no only and admin actions need an
        // auditable free-text reason. Confirm step does use the
        // shared dialog so the visual treatment matches user-facing
        // destructive flows.
        const reason = window.prompt(
            "Reason for soft-deleting this recording (logged):",
        );
        if (!reason || reason.trim().length < 4) {
            toast.error("Reason required (min 4 chars)");
            return;
        }
        void confirm({
            title: "Soft-delete this recording?",
            description:
                "The user will no longer see it. The audio blob is retained on storage for recovery.",
            confirmLabel: "Soft-delete",
            pendingLabel: "Deleting…",
            destructive: true,
            onConfirm: async () => {
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
                        toast.error(
                            "Admin session expired. Reauth and try again.",
                        );
                        replace(
                            `/admin/reauth?next=${window.location.pathname}`,
                        );
                        return;
                    }
                    if (!res.ok) {
                        const j = await res.json().catch(() => ({}));
                        throw new Error(j.error ?? `Failed (${res.status})`);
                    }
                    toast.success("Recording soft-deleted");
                    refresh();
                } finally {
                    setBusy(false);
                }
            },
        });
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
