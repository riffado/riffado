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
    const counts = overview.counts;

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
                <Tile label="Pro" value={counts.proPlan} />
                <Tile label="Free/lockout" value={counts.freePlan} />
                <Tile label="In trial" value={counts.inTrial} />
                <Tile label="In grace" value={counts.inGrace} />
                <Tile label="Active subs" value={counts.activeSubscriptions} />
                <Tile
                    label="Past-due subs"
                    value={counts.pastDueSubscriptions}
                />
                <Tile
                    label="Cancel pending"
                    value={counts.cancelPendingSubscriptions}
                />
                <Tile
                    label="Monthly / annual"
                    value={`${counts.monthlySubscriptions} / ${counts.annualSubscriptions}`}
                />
                <Tile
                    label="First payments, 30d"
                    value={counts.firstPaymentsLast30Days}
                />
                <Tile label="Founding members" value={counts.foundingMembers} />
                <Tile
                    label="Founding slots claimed / reserved"
                    value={`${counts.foundingSlotsClaimed} / ${counts.foundingSlotsReserved}`}
                />
                <Tile
                    label="Founding slots left"
                    value={counts.foundingSlotsRemaining}
                />
                <Tile label="Total users" value={counts.totalUsers} />
            </div>

            {overview.activeMrrByCurrency.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold mb-2">
                        Active MRR-equivalent by currency
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {overview.activeMrrByCurrency.map((row) => (
                            <Tile
                                key={row.amountCurrency}
                                label={`${row.amountCurrency} (${row.subscriptionCount} subs)`}
                                value={formatMoney(row.monthlyEquivalent)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {overview.unknownLivePriceGroups.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold mb-2">
                        Unknown live Stripe Price groups
                    </h2>
                    <div className="overflow-x-auto rounded border">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/30 text-left">
                                    <th className="px-3 py-2">Price id</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Currency</th>
                                    <th className="px-3 py-2">Interval</th>
                                    <th className="px-3 py-2">Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {overview.unknownLivePriceGroups.map((row) => (
                                    <tr
                                        key={`${row.stripePriceId ?? "none"}:${row.status}:${row.amountCurrency}:${row.interval}`}
                                        className="border-b"
                                    >
                                        <td className="px-3 py-2 font-mono text-xs">
                                            {row.stripePriceId ?? "(none)"}
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge status={row.status} />
                                        </td>
                                        <td className="px-3 py-2">
                                            {row.amountCurrency}
                                        </td>
                                        <td className="px-3 py-2">
                                            {row.interval || "\u2014"}
                                        </td>
                                        <td className="px-3 py-2 tabular-nums">
                                            {row.subscriptionCount}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
                        {["all", "active", "past_due", "canceled"].map((s) => (
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
                                <th className="px-3 py-2">Interval</th>
                                <th className="px-3 py-2">Price id</th>
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
                                        {s.interval || "\u2014"}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-xs">
                                        {s.stripePriceId ?? "\u2014"}
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
                                        colSpan={7}
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
                                // biome-ignore lint/suspicious/noArrayIndexKey: page numbers are stable and sequential
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

function formatMoney(value: string): string {
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return value;
    return numeric.toFixed(2);
}

function Tile({ label, value }: { label: string; value: number | string }) {
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
            : status === "past_due"
              ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
              : status === "canceled"
                ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
                : "bg-muted text-muted-foreground border-border";
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border ${color}`}>
            {status}
        </span>
    );
}
