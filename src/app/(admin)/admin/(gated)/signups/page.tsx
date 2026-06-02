import { signupsByDay } from "@/db/queries/admin";
import { formatNumber } from "../_components/metrics";

export const dynamic = "force-dynamic";

export default async function AdminSignupsPage() {
    const rows = await signupsByDay(90);
    const max = rows.reduce((acc, r) => Math.max(acc, r.n), 0);
    const total = rows.reduce((acc, r) => acc + r.n, 0);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Signups</h1>
                <p className="text-sm text-muted-foreground">
                    Last 90 days, by day. {formatNumber(total)} total.
                </p>
            </div>

            <div className="border rounded-xl p-4 bg-card overflow-x-auto">
                <div className="flex items-end gap-1 h-40 min-w-[600px]">
                    {rows.map((r) => {
                        const h = max > 0 ? Math.max(2, (r.n / max) * 100) : 2;
                        return (
                            <div
                                key={r.day}
                                className="flex-1 bg-foreground/70 rounded-t hover:bg-foreground transition-colors"
                                style={{ height: `${h}%` }}
                                title={`${r.day}: ${r.n}`}
                            />
                        );
                    })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>{rows[0]?.day ?? "—"}</span>
                    <span>{rows[rows.length - 1]?.day ?? "—"}</span>
                </div>
            </div>

            <div className="border rounded-xl overflow-hidden max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase sticky top-0">
                        <tr className="text-left">
                            <th className="px-3 py-2">Day</th>
                            <th className="px-3 py-2 text-right">Signups</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows
                            .slice()
                            .reverse()
                            .map((r) => (
                                <tr key={r.day} className="border-t">
                                    <td className="px-3 py-2 font-mono text-xs">
                                        {r.day}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {formatNumber(r.n)}
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
