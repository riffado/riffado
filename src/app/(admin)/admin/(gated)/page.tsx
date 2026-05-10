import { fleetOverview } from "@/lib/admin/queries";
import {
    formatBytes,
    formatHours,
    formatNumber,
    MetricCard,
} from "./_components/metrics";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
    const stats = await fleetOverview();

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Fleet overview</h1>
                <p className="text-sm text-muted-foreground">
                    Cost-shaped metrics. Deltas compare last 7 days vs the prior
                    7 days. All counts exclude tombstoned recordings.
                </p>
            </div>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Users
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Total users"
                        value={formatNumber(stats.userTotal)}
                    />
                    <MetricCard
                        label="New signups (7d)"
                        value={formatNumber(stats.signupsLast7)}
                        sub={`${formatNumber(stats.signupsLast30)} in last 30d`}
                        delta={{
                            current: stats.signupsLast7,
                            prior: stats.signupsPrior7,
                            healthyDirection: "up",
                        }}
                    />
                    <MetricCard
                        label="Active 7d"
                        value={formatNumber(stats.activeUsers7d)}
                        sub={`${formatNumber(stats.activeUsers30d)} active 30d`}
                    />
                    <MetricCard
                        label="Suspended"
                        value={formatNumber(stats.suspendedUsers)}
                        accent={
                            stats.suspendedUsers > 0 ? "warning" : undefined
                        }
                        delta={{
                            current: stats.suspensionsLast7,
                            prior: stats.suspensionsPrior7,
                            // More suspensions = abuse spike, treat as bad.
                            healthyDirection: "down",
                        }}
                    />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Plaud connections
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="New connections (7d)"
                        value={formatNumber(stats.plaudConnectionsLast7)}
                        sub="signup → connected (real activation)"
                        delta={{
                            current: stats.plaudConnectionsLast7,
                            prior: stats.plaudConnectionsPrior7,
                            healthyDirection: "up",
                        }}
                    />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Recordings & storage
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Total recordings"
                        value={formatNumber(stats.recordingTotal)}
                    />
                    <MetricCard
                        label="Total storage"
                        value={formatBytes(stats.storageBytes)}
                    />
                    <MetricCard
                        label="Recordings (7d)"
                        value={formatNumber(stats.recordingsLast7)}
                        delta={{
                            current: stats.recordingsLast7,
                            prior: stats.recordingsPrior7,
                            healthyDirection: "up",
                        }}
                    />
                    <MetricCard
                        label="Bytes uploaded (7d)"
                        value={formatBytes(stats.bytesLast7)}
                        sub="counts toward storage cost"
                        delta={{
                            current: stats.bytesLast7,
                            prior: stats.bytesPrior7,
                            healthyDirection: "down",
                            format: formatBytes,
                        }}
                    />
                    <MetricCard
                        label="Avg / recording"
                        value={
                            stats.recordingTotal > 0
                                ? formatBytes(
                                      stats.storageBytes / stats.recordingTotal,
                                  )
                                : "—"
                        }
                    />
                    <MetricCard
                        label="Local / S3 split"
                        value={(() => {
                            const local = stats.storageByType.local ?? 0;
                            const s3 = stats.storageByType.s3 ?? 0;
                            const total = local + s3;
                            if (total === 0) return "—";
                            const s3Pct = Math.round((s3 / total) * 100);
                            return `${100 - s3Pct}% / ${s3Pct}%`;
                        })()}
                        sub={`${formatBytes(
                            stats.storageByType.local ?? 0,
                        )} local · ${formatBytes(
                            stats.storageByType.s3 ?? 0,
                        )} S3`}
                    />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Transcription
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        label="Server tx (7d)"
                        value={formatNumber(stats.serverTranscriptionsLast7)}
                        sub="our cost"
                        delta={{
                            current: stats.serverTranscriptionsLast7,
                            prior: stats.serverTranscriptionsPrior7,
                            healthyDirection: "down",
                        }}
                    />
                    <MetricCard
                        label="Server audio (7d)"
                        value={formatHours(stats.serverAudioMsLast7)}
                        sub="Whisper bills by minute"
                        delta={{
                            current: stats.serverAudioMsLast7,
                            prior: stats.serverAudioMsPrior7,
                            healthyDirection: "down",
                            format: formatHours,
                        }}
                    />
                    <MetricCard
                        label="Server tx (30d)"
                        value={formatNumber(stats.serverTranscriptionsLast30)}
                    />
                    <MetricCard
                        label="AI enhancements (7d)"
                        value={formatNumber(stats.enhancementsLast7)}
                        delta={{
                            current: stats.enhancementsLast7,
                            prior: stats.enhancementsPrior7,
                            healthyDirection: "down",
                        }}
                    />
                    <MetricCard
                        label="Server (all-time)"
                        value={formatNumber(
                            stats.transcriptionByType.server ?? 0,
                        )}
                    />
                    <MetricCard
                        label="Browser (all-time)"
                        value={formatNumber(
                            stats.transcriptionByType.browser ?? 0,
                        )}
                        sub="zero cost"
                    />
                    <MetricCard
                        label="AI enhancements (total)"
                        value={formatNumber(stats.enhancementTotal)}
                    />
                    <MetricCard
                        label="Transcription coverage"
                        value={(() => {
                            if (stats.recordingTotal === 0) return "—";
                            const covered =
                                stats.recordingTotal -
                                stats.recordingsWithoutTranscriptionTotal;
                            const pct = (covered / stats.recordingTotal) * 100;
                            return `${pct.toFixed(1)}%`;
                        })()}
                        sub={`${formatNumber(
                            stats.recordingTotal -
                                stats.recordingsWithoutTranscriptionTotal,
                        )} of ${formatNumber(stats.recordingTotal)} recordings`}
                        delta={(() => {
                            // Compare *coverage rate* of the 7d cohort vs the
                            // prior-7d cohort, expressed as percentage points
                            // (×100). Drops here = transcription pipeline
                            // silently failing on fresh recordings.
                            const cur =
                                stats.recordingsLast7 > 0
                                    ? ((stats.recordingsLast7 -
                                          stats.recordingsWithoutTranscriptionLast7) /
                                          stats.recordingsLast7) *
                                      10000
                                    : 0;
                            const prior =
                                stats.recordingsPrior7 > 0
                                    ? ((stats.recordingsPrior7 -
                                          stats.recordingsWithoutTranscriptionPrior7) /
                                          stats.recordingsPrior7) *
                                      10000
                                    : 0;
                            return {
                                current: Math.round(cur),
                                prior: Math.round(prior),
                                healthyDirection: "up" as const,
                                format: (n: number) =>
                                    `${(n / 100).toFixed(1)}pp`,
                                suppressPercent: true,
                            };
                        })()}
                    />
                </div>
            </section>
        </div>
    );
}
