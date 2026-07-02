import Link from "next/link";
import {
    billingOverview,
    listGraceUsers,
    listSubscriptions,
} from "@/db/queries/admin-billing";
import { formatRelative } from "../_components/metrics";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminBillingPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>;
}) {
    const sp = await searchParams;
    const status = sp.status || undefined;
    const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [overview, subs, graceUsers] = await Promise.all([
        billingOverview(),
        listSubscriptions({ limit: PAGE_SIZE, offset, status }),
        listGraceUsers(),
    ]);
    const pages = Math.max(1, Math.ceil(subs.total / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Billing</h1>
                <p className="text-sm text-muted-foreground">
                    Subscription and grace-period overview. Read-only.
                </p>
            </div>

            {/* Overview tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile label="Pro" value={overview.proPlan} />
                <Tile label="Free/lockout" value={overview.freePlan} />
                <Tile label="In trial" value={overview.inTrial} />
                <Tile label="In grace" value={overview.inGrace} />
                <Tile
                    label="Founding members"
                    value={overview.foundingMembers}
                />
                <Tile
                    label="Active subs"
                    value={overview.activeSubscriptions}
                />
                <Tile
                    label="Canceled subs"
                    value={overview.canceledSubscriptions}
                />
                <Tile label="Total users" value={overview.totalUsers} />
            </div>

            {/* Grace users */}
            {graceUsers.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold mb-2">
                        Accounts in grace ({graceUsers.length})
                    </h2>
                    <div className="overflow-x-auto rounded border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/30 text-left">
                                    <th className="px-3 py-2">Email</th>
                                    <th className="px-3 py-2">Plan</th>
                                    <th className="px-3 py-2">Ever paid</th>
                                    <th className="px-3 py-2">Deletion at</th>
                                </tr>
                            </thead>
                            <tbody>
                                {graceUsers.map((u) => (
                                    <tr key={u.userId} className="border-b">
                                        <td className="px-3 py-2">
                                            <Link
                                                href={`/admin/users/${u.userId}`}
                                                className="underline underline-offset-2"
                                            >
                                                {u.email}
                                            </Link>
                                        </td>
                                        <td className="px-3 py-2">{u.plan}</td>
                                        <td className="px-3 py-2">
                                            {u.everPaidAt
                                                ? formatRelative(u.everPaidAt)
                                                : "never"}
                                        </td>
                                        <td className="px-3 py-2">
                                            {formatRelative(u.deletionAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Subscriptions */}
            <div>
                <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-sm font-semibold">
                        Subscriptions ({subs.total})
                    </h2>
                    <div className="flex gap-2 text-xs">
                        {["all", "active", "canceled"].map((s) => (
                            <Link
                                key={s}
                                href={`/admin/billing${s === "all" ? "" : `?status=${s}`}`}
                                className={`px-2 py-1 rounded border ${
                                    (s === "all" && !status) || s === status
                                        ? "bg-foreground text-background"
                                        : "bg-muted/30"
                                }`}
                            >
                                {s}
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto rounded border">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/30 text-left">
                                <th className="px-3 py-2">User</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Amount</th>
                                <th className="px-3 py-2">Next payment</th>
                                <th className="px-3 py-2">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {subs.rows.map((s) => (
                                <tr key={s.subId} className="border-b">
                                    <td className="px-3 py-2">
                                        <Link
                                            href={`/admin/users/${s.userId}`}
                                            className="underline underline-offset-2"
                                        >
                                            {s.userEmail}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-2">
                                        <StatusBadge status={s.status} />
                                    </td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {s.amountValue} {s.amountCurrency}
                                    </td>
                                    <td className="px-3 py-2">
                                        {s.nextPaymentAt
                                            ? formatRelative(s.nextPaymentAt)
                                            : "\u2014"}
                                    </td>
                                    <td className="px-3 py-2">
                                        {formatRelative(s.createdAt)}
                                    </td>
                                </tr>
                            ))}
                            {subs.rows.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-3 py-6 text-center text-muted-foreground"
                                    >
                                        No subscriptions found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {pages > 1 && (
                    <div className="flex gap-2 mt-2 text-xs">
                        {Array.from({ length: pages }, (_, i) => (
                            <Link
                                key={i + 1}
                                href={`/admin/billing?page=${i + 1}${status ? `&status=${status}` : ""}`}
                                className={`px-2 py-1 rounded border ${
                                    i + 1 === page
                                        ? "bg-foreground text-background"
                                        : "bg-muted/30"
                                }`}
                            >
                                {i + 1}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Tile({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded border bg-card px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const color =
        status === "active"
            ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
            : status === "canceled"
              ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
              : "bg-muted text-muted-foreground border-border";
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border ${color}`}>
            {status}
        </span>
    );
}
