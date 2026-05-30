import { syncHealth } from "@/db/queries/admin";
import { formatNumber } from "../_components/metrics";

export const dynamic = "force-dynamic";

const BUCKET_LABEL: Record<string, { label: string; tone: string }> = {
    fresh: { label: "Synced < 1h ago", tone: "text-emerald-700" },
    stale_24h: { label: "1h–24h", tone: "text-foreground" },
    stale_7d: { label: "1d–7d", tone: "text-amber-700" },
    stale_old: { label: "> 7d", tone: "text-red-700" },
    never: { label: "Never synced", tone: "text-muted-foreground" },
};

const BUCKET_ORDER = ["fresh", "stale_24h", "stale_7d", "stale_old", "never"];

export default async function AdminSyncPage() {
    const buckets = await syncHealth();
    const map = new Map(
        buckets.map((b: { bucket: string; n: number }) => [b.bucket, b.n]),
    );

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Sync health</h1>
                <p className="text-sm text-muted-foreground">
                    Per-Plaud-connection freshness. Buckets are last-sync age.
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {BUCKET_ORDER.map((key) => {
                    const meta = BUCKET_LABEL[key];
                    const n = Number(map.get(key) ?? 0);
                    return (
                        <div
                            key={key}
                            className="border rounded-xl p-4 bg-card"
                        >
                            <div className="text-xs text-muted-foreground">
                                {meta.label}
                            </div>
                            <div
                                className={`text-2xl font-semibold mt-1 ${meta.tone}`}
                            >
                                {formatNumber(n)}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="text-xs text-muted-foreground border rounded-xl p-4 bg-muted/20">
                Note: this view derives freshness from
                <code className="mx-1 font-mono">
                    plaud_connections.last_sync
                </code>
                only. Per-run error metrics will appear here once a
                <code className="mx-1 font-mono">sync_runs</code> table exists.
            </div>
        </div>
    );
}
