import { APP_VERSION_TAG } from "@/lib/version";

export const DISCORD_URL = "https://discord.gg/JygWxS2VA8";

const GITHUB_NEW_ISSUE_URL =
    "https://github.com/mesynx-ai/mesynx-ai/issues/new";
const BUG_REPORT_TEMPLATE = "bug_report.yml";

export interface ReportBugOptions {
    errorId?: string;
    errorContext?: string;
    page?: string;
    isHosted?: boolean;
}

export function buildReportBugUrl(opts: ReportBugOptions): string {
    const params = new URLSearchParams({
        template: BUG_REPORT_TEMPLATE,
        version: APP_VERSION_TAG,
    });

    const description = buildDescription(opts);
    if (description) {
        params.set("description", description);
    }

    if (opts.isHosted !== undefined) {
        params.set(
            "deployment",
            opts.isHosted ? "Hosted (mesynx.r0073dl053r.com)" : "Self-hosted",
        );
    }

    const additional = buildAdditional(opts);
    if (additional) {
        params.set("additional", additional);
    }

    return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
}

/** Returns the Discord server URL for support (replaces the old mailto fallback). */
export function buildReportBugDiscordUrl(): string {
    return DISCORD_URL;
}

export function buildReportBugBodyPreview(opts: ReportBugOptions): string {
    const parts = [buildDescription(opts), "", buildAdditional(opts)].filter(
        Boolean,
    );
    return parts.join("\n");
}

function buildDescription(opts: ReportBugOptions): string {
    const lines: string[] = [];
    if (opts.errorContext) {
        lines.push(`While trying to: ${opts.errorContext}`);
    }
    if (opts.errorId) {
        if (lines.length > 0) lines.push("");
        lines.push(`Error id: \`${opts.errorId}\``);
    }
    return lines.join("\n");
}

function buildAdditional(opts: ReportBugOptions): string {
    const lines: string[] = [];
    if (opts.page) {
        lines.push(`Page: \`${opts.page}\``);
    }
    lines.push(`Version: ${APP_VERSION_TAG}`);
    if (opts.isHosted !== undefined) {
        lines.push(
            `Mode: ${opts.isHosted ? "Hosted (mesynx.r0073dl053r.com)" : "Self-hosted"}`,
        );
    }
    return lines.join("\n");
}
