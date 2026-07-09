import Link from "next/link";
import {
    exportJobsOverview,
    listRecentExportJobs,
} from "@/db/queries/admin-export";
import {
    formatBytes,
    formatDate,
    formatNumber,
    MetricCard,
} from "../_components/metrics";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUSES = ["pending", "processing", "completed", "failed"] as const;

function statusBadge(status: string): string {
    switch (status) {
        case "completed":
            return "text-emerald-700";
        case "failed":
            return "text-red-700";
        case "processing":
            return "text-foreground";
        default:
            return "text-muted-foreground";
    }
}

export default async function AdminExportsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>;
}) {
    const sp = await searchParams;
    const status = sp.status || undefined;
    const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [overview, jobs] = await Promise.all([
        exportJobsOverview(),
        listRecentExportJobs({ limit: PAGE_SIZE, offset, status }),
    ]);
    const pages = Math.max(1, Math.ceil(jobs.total / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Data exports</h1>
                <p className="text-sm text-muted-foreground">
                    Full-archive backup jobs (audio + transcripts + summaries).
                    Read-only.
                </p>
            </div>

            {overview.stuckProcessing > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
                    {overview.stuckProcessing} job
                    {overview.stuckProcessing === 1 ? "" : "s"} stuck in{" "}
                    <code className="font-mono">processing</code> for over 45
                    minutes. The worker's own stale-job reclaim (30 min) should
                    have already reset these -- if this number keeps climbing,
                    the export worker likely isn't running on at least one
                    instance.
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                    label="Pending"
                    value={formatNumber(overview.pending)}
                />
                <MetricCard
                    label="Processing"
                    value={formatNumber(overview.processing)}
                    accent={
                        overview.stuckProcessing > 0 ? "warning" : undefined
                    }
                />
                <MetricCard
                    label="Retained archives"
                    value={formatNumber(overview.completedRetained)}
                    sub={formatBytes(overview.retainedBytes)}
                />
                <MetricCard
                    label="Failed (24h)"
                    value={formatNumber(overview.failedLast24h)}
                    accent={overview.failedLast24h > 0 ? "warning" : undefined}
                    sub={`${formatNumber(overview.failedLast7d)} in 7d`}
                />
                <MetricCard
                    label="Created (24h)"
                    value={formatNumber(overview.createdLast24h)}
                    sub={`${formatNumber(overview.createdLast7d)} in 7d`}
                />
            </div>

            <div>
                <div className="flex items-center gap-2 mb-2 text-sm">
                    <span className="text-muted-foreground">Filter:</span>
                    <Link
                        href="/admin/exports"
                        className={
                            !status ? "font-medium" : "text-muted-foreground"
                        }
                    >
                        All
                    </Link>
                    {STATUSES.map((s) => (
                        <Link
                            key={s}
                            href={`/admin/exports?status=${s}`}
                            className={
                                status === s
                                    ? "font-medium"
                                    : "text-muted-foreground"
                            }
                        >
                            {s}
                        </Link>
                    ))}
                </div>

                <div className="overflow-x-auto rounded border">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/30 text-left">
                                <th className="px-3 py-2">User</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Recordings</th>
                                <th className="px-3 py-2">Size</th>
                                <th className="px-3 py-2">Attempts</th>
                                <th className="px-3 py-2">Created</th>
                                <th className="px-3 py-2">Completed</th>
                                <th className="px-3 py-2">Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.rows.map((job) => (
                                <tr key={job.id} className="border-b">
                                    <td className="px-3 py-2">
                                        <Link
                                            href={`/admin/users/${job.userId}`}
                                            className="hover:underline"
                                        >
                                            {job.userEmail}
                                        </Link>
                                    </td>
                                    <td
                                        className={`px-3 py-2 font-medium ${statusBadge(job.status)}`}
                                    >
                                        {job.status}
                                    </td>
                                    <td className="px-3 py-2">
                                        {job.recordingCount ?? "\u2014"}
                                    </td>
                                    <td className="px-3 py-2">
                                        {job.fileSize
                                            ? formatBytes(job.fileSize)
                                            : "\u2014"}
                                    </td>
                                    <td className="px-3 py-2">
                                        {job.attempts > 1 ? (
                                            <span className="text-amber-700">
                                                {job.attempts}
                                            </span>
                                        ) : (
                                            job.attempts
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {formatDate(job.createdAt)}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {formatDate(job.completedAt)}
                                    </td>
                                    <td className="px-3 py-2 text-red-700 max-w-xs truncate">
                                        {job.errorMessage ?? ""}
                                    </td>
                                </tr>
                            ))}
                            {jobs.rows.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={8}
                                        className="px-3 py-6 text-center text-muted-foreground"
                                    >
                                        No export jobs
                                        {status
                                            ? ` with status "${status}"`
                                            : ""}
                                        .
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {pages > 1 && (
                    <div className="flex items-center gap-2 mt-3 text-sm">
                        {page > 1 && (
                            <Link
                                href={`/admin/exports?${status ? `status=${status}&` : ""}page=${page - 1}`}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                ← Prev
                            </Link>
                        )}
                        <span className="text-muted-foreground">
                            Page {page} of {pages}
                        </span>
                        {page < pages && (
                            <Link
                                href={`/admin/exports?${status ? `status=${status}&` : ""}page=${page + 1}`}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                Next →
                            </Link>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
