import Link from "next/link";
import { storageHistogram, topStorageUsers } from "@/db/queries/admin";
import { formatBytes, formatNumber } from "../_components/metrics";

export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
    const [hist, top] = await Promise.all([
        storageHistogram(),
        topStorageUsers(50),
    ]);
    const totalBytes = top.reduce(
        (acc: number, u: { bytes: number }) => acc + Number(u.bytes),
        0,
    );

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Storage</h1>
                <p className="text-sm text-muted-foreground">
                    Where the GBs are. Cost driver for hosted instance.
                </p>
            </div>

            <section>
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    Distribution
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {hist.map((b: { bucket: string; n: number }) => (
                        <div
                            key={b.bucket}
                            className="border rounded-xl p-4 bg-card"
                        >
                            <div className="text-xs text-muted-foreground">
                                {b.bucket}
                            </div>
                            <div className="text-2xl font-semibold mt-1">
                                {formatNumber(b.n)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                                users
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Top 50 by bytes</h2>
                    <span className="text-xs text-muted-foreground">
                        sum: {formatBytes(totalBytes)}
                    </span>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase">
                        <tr className="text-left">
                            <th className="px-3 py-2 w-12">#</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2 text-right">Recordings</th>
                            <th className="px-3 py-2 text-right">Bytes</th>
                            <th className="px-3 py-2 text-right">% of top50</th>
                        </tr>
                    </thead>
                    <tbody>
                        {top.map(
                            (
                                u: {
                                    user_id: string;
                                    email: string;
                                    recording_count: number;
                                    bytes: number;
                                },
                                i: number,
                            ) => (
                                <tr key={u.user_id} className="border-t">
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {i + 1}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Link
                                            href={`/admin/users/${u.user_id}`}
                                            className="hover:underline"
                                        >
                                            {u.email}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {formatNumber(u.recording_count)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {formatBytes(Number(u.bytes))}
                                    </td>
                                    <td className="px-3 py-2 text-right text-muted-foreground">
                                        {totalBytes > 0
                                            ? `${(
                                                  (Number(u.bytes) /
                                                      totalBytes) *
                                                      100
                                              ).toFixed(1)}%`
                                            : "—"}
                                    </td>
                                </tr>
                            ),
                        )}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
