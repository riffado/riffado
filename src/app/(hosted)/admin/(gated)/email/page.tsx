import {
    countCampaigns,
    listCampaignsOverview,
    newsletterStats,
    recentSuppressions,
    suppressionCountsByReason,
} from "@/db/queries/admin-email";
import type { CampaignKind } from "@/db/queries/email-campaigns";
import { isSmtpConfigured } from "@/lib/smtp";
import { formatDate, formatNumber } from "../_components/metrics";

export const dynamic = "force-dynamic";

const CAMPAIGNS_LIMIT = 50;
const SUPPRESSIONS_LIMIT = 50;

const KIND_LABEL: Record<CampaignKind, string> = {
    transactional: "Transactional",
    announcement: "Announcement",
    marketing: "Marketing",
};

export default async function AdminEmailPage() {
    const [
        campaigns,
        campaignTotal,
        suppressionCounts,
        suppressions,
        newsletter,
    ] = await Promise.all([
        listCampaignsOverview(CAMPAIGNS_LIMIT),
        countCampaigns(),
        suppressionCountsByReason(),
        recentSuppressions(SUPPRESSIONS_LIMIT),
        newsletterStats(),
    ]);

    const smtpConfigured = isSmtpConfigured();
    // Full-table aggregate, not derived from the capped `suppressions` list --
    // stays accurate even once the recent-suppressions table truncates.
    const totalSuppressed = suppressionCounts.reduce((acc, r) => acc + r.n, 0);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Email</h1>
                <p className="text-sm text-muted-foreground">
                    Campaign delivery, suppression list, and newsletter funnel.
                </p>
            </div>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border rounded-xl p-4 bg-card">
                    <div className="text-xs text-muted-foreground">SMTP</div>
                    <div
                        className={
                            smtpConfigured
                                ? "text-2xl font-semibold mt-1 text-emerald-600"
                                : "text-2xl font-semibold mt-1 text-amber-600"
                        }
                    >
                        {smtpConfigured ? "Configured" : "Not configured"}
                    </div>
                </div>
                <div className="border rounded-xl p-4 bg-card">
                    <div className="text-xs text-muted-foreground">
                        Campaigns
                    </div>
                    <div className="text-2xl font-semibold mt-1">
                        {formatNumber(campaignTotal)}
                    </div>
                </div>
                <div className="border rounded-xl p-4 bg-card">
                    <div className="text-xs text-muted-foreground">
                        Suppressed addresses
                    </div>
                    <div className="text-2xl font-semibold mt-1">
                        {formatNumber(totalSuppressed)}
                    </div>
                </div>
                <div className="border rounded-xl p-4 bg-card">
                    <div className="text-xs text-muted-foreground">
                        Newsletter signups
                    </div>
                    <div className="text-2xl font-semibold mt-1">
                        {formatNumber(newsletter.total)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {formatNumber(newsletter.confirmed)} confirmed,{" "}
                        {formatNumber(newsletter.unsubscribed)} unsubscribed
                    </div>
                </div>
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Campaigns</h2>
                    {campaignTotal > campaigns.length ? (
                        <span className="text-xs text-muted-foreground">
                            showing latest {campaigns.length} of{" "}
                            {formatNumber(campaignTotal)}
                        </span>
                    ) : null}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-xs uppercase">
                            <tr className="text-left">
                                <th className="px-3 py-2">Slug</th>
                                <th className="px-3 py-2">Subject</th>
                                <th className="px-3 py-2">Kind</th>
                                <th className="px-3 py-2 text-right">Sent</th>
                                <th className="px-3 py-2 text-right">Failed</th>
                                <th className="px-3 py-2 text-right">
                                    Skipped
                                </th>
                                <th className="px-3 py-2 text-right">
                                    Pending
                                </th>
                                <th className="px-3 py-2 text-right">Other</th>
                                <th className="px-3 py-2 text-right">
                                    Attempted
                                </th>
                                <th className="px-3 py-2">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={10}
                                        className="px-3 py-6 text-center text-muted-foreground"
                                    >
                                        No campaigns sent yet.
                                    </td>
                                </tr>
                            ) : (
                                campaigns.map((c) => (
                                    <tr key={c.id} className="border-t">
                                        <td className="px-3 py-2 font-mono text-xs">
                                            {c.slug}
                                        </td>
                                        <td className="px-3 py-2">
                                            {c.subject}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {KIND_LABEL[c.kind]}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {formatNumber(c.sent)}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {c.failed > 0 ? (
                                                <span className="text-red-600">
                                                    {formatNumber(c.failed)}
                                                </span>
                                            ) : (
                                                "0"
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right text-muted-foreground">
                                            {formatNumber(c.skipped)}
                                        </td>
                                        <td className="px-3 py-2 text-right text-muted-foreground">
                                            {formatNumber(c.pending)}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {c.other > 0 ? (
                                                <span
                                                    className="text-amber-600"
                                                    title="Deliveries with a status that didn't match sent/failed/skipped/pending -- investigate."
                                                >
                                                    {formatNumber(c.other)}
                                                </span>
                                            ) : (
                                                "0"
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {formatNumber(c.attempted)}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {formatDate(c.createdAt)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">
                        Suppressions by reason
                    </h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
                    {suppressionCounts.length === 0 ? (
                        <div className="text-sm text-muted-foreground col-span-full">
                            No suppressed addresses.
                        </div>
                    ) : (
                        suppressionCounts.map((r) => (
                            <div
                                key={r.reason}
                                className="border rounded-xl p-4 bg-card"
                            >
                                <div className="text-xs text-muted-foreground capitalize">
                                    {r.reason}
                                </div>
                                <div className="text-2xl font-semibold mt-1">
                                    {formatNumber(r.n)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            <section className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Recent suppressions</h2>
                    {totalSuppressed > suppressions.length ? (
                        <span className="text-xs text-muted-foreground">
                            showing latest {suppressions.length} of{" "}
                            {formatNumber(totalSuppressed)}
                        </span>
                    ) : null}
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase">
                        <tr className="text-left">
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Reason</th>
                            <th className="px-3 py-2">Note</th>
                            <th className="px-3 py-2">Since</th>
                        </tr>
                    </thead>
                    <tbody>
                        {suppressions.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    No suppressed addresses.
                                </td>
                            </tr>
                        ) : (
                            suppressions.map((s) => (
                                <tr key={s.email} className="border-t">
                                    <td className="px-3 py-2">{s.email}</td>
                                    <td className="px-3 py-2 text-muted-foreground capitalize">
                                        {s.reason}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {s.note ?? "—"}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                        {formatDate(s.createdAt)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
