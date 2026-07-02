import { pricingSnapshot } from "@/db/queries/admin";
import { formatBytes, formatNumber } from "../_components/metrics";
import { ExportCsvButton } from "./export-csv-button";

export const dynamic = "force-dynamic";

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
        sorted.length - 1,
        Math.floor((p / 100) * (sorted.length - 1)),
    );
    return sorted[idx];
}

interface Summary {
    n: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
}

function summary(sorted: number[]): Summary {
    return {
        n: sorted.length,
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
    };
}

export default async function AdminPricingSnapshotPage() {
    const snap = await pricingSnapshot();
    const storage = summary(snap.storageBytesPerUser);
    const recordings = summary(snap.recordingsPerUser);
    const serverTx = summary(snap.serverTranscriptions30dPerUser);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Pricing snapshot</h1>
                    <p className="text-sm text-muted-foreground">
                        Per-user CDFs to inform plan tier thresholds. Only users
                        with ≥1 recording / transcription appear in each
                        distribution.
                    </p>
                </div>
                <ExportCsvButton />
            </div>

            <DistributionCard
                title="Storage per user"
                fmt={formatBytes}
                summary={storage}
            />
            <DistributionCard
                title="Recordings per user (all-time)"
                fmt={formatNumber}
                summary={recordings}
            />
            <DistributionCard
                title="Server transcriptions per user (last 30d)"
                fmt={formatNumber}
                summary={serverTx}
            />

            <div className="text-xs text-muted-foreground border rounded-xl p-4 bg-muted/20">
                CSV export logs each call as a{" "}
                <code className="font-mono">csv_export_pricing_snapshot</code>{" "}
                row in <code className="font-mono">admin_action_log</code> --
                bulk exports of email-bearing data are auditable. Reason text is
                required and stored alongside the export.
            </div>
        </div>
    );
}

function DistributionCard({
    title,
    fmt,
    summary,
}: {
    title: string;
    fmt: (n: number) => string;
    summary: Summary;
}) {
    return (
        <section className="border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between">
                <h2 className="text-sm font-medium">{title}</h2>
                <span className="text-xs text-muted-foreground">
                    {summary.n} users
                </span>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 divide-x">
                {[
                    ["p50", summary.p50],
                    ["p75", summary.p75],
                    ["p90", summary.p90],
                    ["p95", summary.p95],
                    ["p99", summary.p99],
                    ["max", summary.max],
                ].map(([label, val]) => (
                    <div key={label as string} className="p-3">
                        <div className="text-xs text-muted-foreground">
                            {label}
                        </div>
                        <div className="text-base font-semibold mt-0.5">
                            {fmt(val as number)}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
