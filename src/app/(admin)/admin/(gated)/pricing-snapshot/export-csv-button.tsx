"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Triggers the CSV export endpoint after collecting a reason. POSTs the
 * reason in a JSON body so it never lands in URL query strings (access
 * logs, browser history, referer). The endpoint is treated as a mutation,
 * so a stale elevated cookie bounces to /admin/reauth.
 */
export function ExportCsvButton() {
    const [busy, setBusy] = useState(false);

    async function onClick() {
        const reason = window.prompt(
            "Reason for downloading the pricing-snapshot CSV (logged):",
        );
        if (!reason || reason.trim().length < 4) {
            toast.error("Reason required (min 4 chars)");
            return;
        }
        setBusy(true);
        try {
            let res: Response;
            try {
                res = await fetch("/api/admin/pricing-snapshot/export.csv", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ reason }),
                });
            } catch (networkErr) {
                console.error("[admin] CSV export network error", networkErr);
                toast.error(
                    "Network error. Check your connection and try again.",
                );
                return;
            }
            if (res.status === 404) {
                toast.error("Admin session expired. Reauth and try again.");
                window.location.href =
                    "/admin/reauth?next=/admin/pricing-snapshot";
                return;
            }
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error ?? `Export failed (${res.status})`);
                return;
            }
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objUrl;
            // Server sets Content-Disposition with a timestamped filename;
            // browsers respect that, but we set a fallback for safety.
            a.download = "openplaud-pricing-snapshot.csv";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objUrl);
            toast.success("Export downloaded");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button onClick={onClick} disabled={busy} variant="outline">
            {busy ? "Exporting..." : "Export CSV"}
        </Button>
    );
}
