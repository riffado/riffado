import Link from "next/link";
import { listUsers } from "@/lib/admin/queries";
import {
    formatBytes,
    formatNumber,
    formatRelative,
} from "../_components/metrics";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SORTS = [
    { key: "newest", label: "Newest" },
    { key: "storage_desc", label: "Storage" },
    { key: "recordings_desc", label: "Recordings" },
    { key: "server_tx_desc", label: "Server tx 30d" },
    { key: "last_sync_desc", label: "Last sync" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

export default async function AdminUsersPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const sort: SortKey = (SORTS.find((s) => s.key === sp.sort)?.key ??
        "newest") as SortKey;
    const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const { rows, total } = await listUsers({
        limit: PAGE_SIZE,
        offset,
        q,
        sort,
    });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Users</h1>
                    <p className="text-sm text-muted-foreground">
                        Cost-attribution view. PII surface: emails visible.
                    </p>
                </div>
                <div className="text-sm text-muted-foreground">
                    {formatNumber(total)} total
                </div>
            </div>

            <form className="flex gap-2 items-center" action="/admin/users">
                <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search by email"
                    className="border rounded px-3 py-2 text-sm bg-background w-64"
                />
                <select
                    name="sort"
                    defaultValue={sort}
                    className="border rounded p-2 text-sm bg-background"
                >
                    {SORTS.map((s) => (
                        <option key={s.key} value={s.key}>
                            Sort: {s.label}
                        </option>
                    ))}
                </select>
                <button
                    type="submit"
                    className="border rounded px-3 py-2 text-sm hover:bg-muted"
                >
                    Apply
                </button>
            </form>

            <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase">
                        <tr className="text-left">
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Joined</th>
                            <th className="px-3 py-2">Last sync</th>
                            <th className="px-3 py-2 text-right">Recordings</th>
                            <th className="px-3 py-2 text-right">Storage</th>
                            <th className="px-3 py-2 text-right">
                                Server tx 30d
                            </th>
                            <th className="px-3 py-2">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((u) => (
                            <tr
                                key={u.id}
                                className="border-t hover:bg-muted/30"
                            >
                                <td className="px-3 py-2">
                                    <Link
                                        href={`/admin/users/${u.id}`}
                                        className="font-medium hover:underline"
                                    >
                                        {u.email}
                                    </Link>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {formatRelative(u.createdAt)}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {formatRelative(u.lastSync)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {formatNumber(u.recordingCount)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {formatBytes(u.storageBytes)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {formatNumber(u.serverTranscriptions30d)}
                                </td>
                                <td className="px-3 py-2">
                                    {u.suspendedAt ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-700 border border-red-500/30">
                                            suspended
                                        </span>
                                    ) : u.plaudConnected ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">
                                            connected
                                        </span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">
                                            no plaud
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="px-3 py-8 text-center text-muted-foreground"
                                >
                                    No users match.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            <Pagination page={page} pages={pages} q={q} sort={sort} />
        </div>
    );
}

function Pagination({
    page,
    pages,
    q,
    sort,
}: {
    page: number;
    pages: number;
    q: string;
    sort: string;
}) {
    if (pages <= 1) return null;
    const make = (p: number) => {
        const sp = new URLSearchParams();
        if (q) sp.set("q", q);
        if (sort) sp.set("sort", sort);
        sp.set("page", String(p));
        return `/admin/users?${sp.toString()}`;
    };
    return (
        <div className="flex items-center gap-2 text-sm">
            <a
                href={page > 1 ? make(page - 1) : "#"}
                className={
                    page > 1
                        ? "border rounded px-3 py-1 hover:bg-muted"
                        : "border rounded px-3 py-1 opacity-40 pointer-events-none"
                }
            >
                Prev
            </a>
            <span className="text-muted-foreground">
                {page} / {pages}
            </span>
            <a
                href={page < pages ? make(page + 1) : "#"}
                className={
                    page < pages
                        ? "border rounded px-3 py-1 hover:bg-muted"
                        : "border rounded px-3 py-1 opacity-40 pointer-events-none"
                }
            >
                Next
            </a>
        </div>
    );
}
