import { notFound } from "next/navigation";
import { getUserDetail } from "@/lib/admin/queries";
import {
    formatBytes,
    formatDate,
    formatNumber,
    formatRelative,
    MetricCard,
} from "../../_components/metrics";
import { RecordingDeleteButton } from "./recording-delete-button";
import { UserActions } from "./user-actions";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const user = await getUserDetail(id);
    if (!user) notFound();

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-xs text-muted-foreground">User</div>
                    <h1 className="text-xl font-semibold">{user.email}</h1>
                    <div className="text-xs text-muted-foreground mt-0.5">
                        id <code className="font-mono">{user.id}</code> · joined{" "}
                        {formatDate(user.createdAt)}
                    </div>
                    {user.suspendedAt ? (
                        <div className="mt-2 text-sm border border-red-500/30 bg-red-500/10 text-red-700 rounded px-3 py-2">
                            Suspended {formatRelative(user.suspendedAt)}:{" "}
                            {user.suspendedReason ?? "no reason recorded"}
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                    label="Recordings"
                    value={formatNumber(user.metrics.recordingCount)}
                />
                <MetricCard
                    label="Storage"
                    value={formatBytes(user.metrics.storageBytes)}
                />
                <MetricCard
                    label="Server transcriptions"
                    value={formatNumber(user.metrics.serverTranscriptionCount)}
                    sub={`${user.metrics.browserTranscriptionCount} browser`}
                />
                <MetricCard
                    label="AI enhancements"
                    value={formatNumber(user.metrics.enhancementCount)}
                    sub={`${user.metrics.apiCredentialCount} API creds`}
                />
            </div>

            <section className="border rounded-xl p-4">
                <h2 className="text-sm font-medium mb-3">Plaud connection</h2>
                {user.plaud.connected ? (
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                        <div>
                            <dt className="text-xs text-muted-foreground">
                                Region
                            </dt>
                            <dd className="font-mono text-xs">
                                {user.plaud.apiBase ?? "—"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">
                                Plaud email
                            </dt>
                            <dd>{user.plaud.plaudEmail ?? "—"}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">
                                Last sync
                            </dt>
                            <dd>{formatRelative(user.plaud.lastSync)}</dd>
                        </div>
                    </dl>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        No Plaud connection.
                    </div>
                )}
            </section>

            <section className="border rounded-xl p-4">
                <h2 className="text-sm font-medium mb-3">Operator actions</h2>
                <UserActions
                    userId={user.id}
                    suspended={user.suspendedAt !== null}
                    plaudConnected={user.plaud.connected}
                />
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30">
                    <h2 className="text-sm font-medium">
                        Recent recordings (50)
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Metadata only. Filenames, transcripts, and audio are
                        intentionally not exposed to admin.
                    </p>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase">
                        <tr className="text-left">
                            <th className="px-3 py-2">ID</th>
                            <th className="px-3 py-2">Started</th>
                            <th className="px-3 py-2 text-right">Duration</th>
                            <th className="px-3 py-2 text-right">Size</th>
                            <th className="px-3 py-2">Device</th>
                            <th className="px-3 py-2">Storage</th>
                            <th className="px-3 py-2">State</th>
                            <th className="px-3 py-2 w-24" />
                        </tr>
                    </thead>
                    <tbody>
                        {user.recentRecordings.map((r) => (
                            <tr key={r.id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">
                                    {r.id.slice(0, 10)}…
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {formatDate(r.startTime)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {Math.round(r.durationMs / 1000)}s
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {formatBytes(r.filesize)}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">
                                    {r.deviceSn.slice(-8)}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    {r.storageType}
                                </td>
                                <td className="px-3 py-2">
                                    {r.deletedAt ? (
                                        <span className="text-xs text-muted-foreground">
                                            deleted
                                        </span>
                                    ) : (
                                        <span className="text-xs">live</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {r.deletedAt ? null : (
                                        <RecordingDeleteButton
                                            recordingId={r.id}
                                        />
                                    )}
                                </td>
                            </tr>
                        ))}
                        {user.recentRecordings.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={8}
                                    className="px-3 py-8 text-center text-muted-foreground"
                                >
                                    No recordings.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
