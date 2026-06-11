import { getInstallHitStats } from "@/lib/admin/install-hits";
import { formatNumber } from "./metrics";

/**
 * Aggregate counter for fetches of `/install.sh` and `/{version}/install.sh`.
 *
 * Read this as a directional trend, not a deployment count. One operator
 * re-running the installer five times is five hits; CI pipelines count
 * every run. See `lib/admin/install-hits.ts` for the privacy model
 * (no IP, no UA, no identifier of any kind).
 */
export async function InstallHitsTile({ days = 30 }: { days?: number }) {
    const stats = await getInstallHitStats(days);

    return (
        <div className="border rounded-xl p-4 bg-card">
            <div className="text-xs text-muted-foreground">
                Install script hits ({days}d)
            </div>
            <div className="text-2xl font-semibold mt-1">
                {formatNumber(stats.total)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
                {formatNumber(stats.distinctVersions)} distinct versions ·
                origin fetches only (undercounted behind CDN cache), incl.
                reruns, CI, bots and link previews. Not an instance count.
            </div>
            {stats.topVersions.length > 0 ? (
                <table className="w-full mt-3 text-xs">
                    <thead>
                        <tr className="text-left text-muted-foreground">
                            <th className="py-1 font-medium">Version</th>
                            <th className="py-1 font-medium text-right">
                                Hits
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.topVersions.map((row) => (
                            <tr key={row.version} className="border-t">
                                <td className="py-1 font-mono text-muted-foreground">
                                    {row.version}
                                </td>
                                <td className="py-1 text-right tabular-nums">
                                    {formatNumber(row.count)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </div>
    );
}
