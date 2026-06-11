import Link from "next/link";
import {
    topServerTranscriptionUsers,
    transcriptionByProvider,
} from "@/db/queries/admin";
import { formatNumber } from "../_components/metrics";

export const dynamic = "force-dynamic";

export default async function AdminTranscriptionPage() {
    const [byProvider, topUsers] = await Promise.all([
        transcriptionByProvider(),
        topServerTranscriptionUsers(50),
    ]);

    type ProviderRow = {
        provider: string;
        type: string;
        n: number;
    };
    const serverRows = byProvider.filter(
        (r: ProviderRow) => r.type === "server",
    );
    const browserRows = byProvider.filter(
        (r: ProviderRow) => r.type === "browser",
    );

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Transcription</h1>
                <p className="text-sm text-muted-foreground">
                    Server-side runs cost us money. Browser is free.
                </p>
            </div>

            <section className="grid md:grid-cols-2 gap-4">
                <div className="border rounded-xl overflow-hidden">
                    <div className="px-4 py-2 border-b bg-muted/30 text-sm font-medium">
                        Server-side by provider (all-time)
                    </div>
                    <table className="w-full text-sm">
                        <tbody>
                            {serverRows.map(
                                (r: { provider: string; n: number }) => (
                                    <tr key={r.provider} className="border-t">
                                        <td className="px-3 py-2">
                                            {r.provider}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {formatNumber(r.n)}
                                        </td>
                                    </tr>
                                ),
                            )}
                            {serverRows.length === 0 ? (
                                <tr>
                                    <td className="px-3 py-6 text-center text-muted-foreground">
                                        none
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>

                <div className="border rounded-xl overflow-hidden">
                    <div className="px-4 py-2 border-b bg-muted/30 text-sm font-medium">
                        Browser by provider (all-time, zero cost)
                    </div>
                    <table className="w-full text-sm">
                        <tbody>
                            {browserRows.map(
                                (r: { provider: string; n: number }) => (
                                    <tr key={r.provider} className="border-t">
                                        <td className="px-3 py-2">
                                            {r.provider}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {formatNumber(r.n)}
                                        </td>
                                    </tr>
                                ),
                            )}
                            {browserRows.length === 0 ? (
                                <tr>
                                    <td className="px-3 py-6 text-center text-muted-foreground">
                                        none
                                    </td>
                                </tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30">
                    <h2 className="text-sm font-medium">
                        Top 50 server-tx users (last 30d)
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        These are the cost outliers for transcription.
                    </p>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase">
                        <tr className="text-left">
                            <th className="px-3 py-2 w-12">#</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2 text-right">
                                Server tx 30d
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {topUsers.map(
                            (
                                u: {
                                    user_id: string;
                                    email: string;
                                    n: number;
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
                                        {formatNumber(Number(u.n))}
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
