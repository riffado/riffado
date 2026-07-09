/**
 * Send the rebrand-announcement campaign.
 *
 * Usage:
 *   bun scripts/send-rebrand-email.ts
 *   bun scripts/send-rebrand-email.ts --dry-run
 *   bun scripts/send-rebrand-email.ts --only-email me@x
 *   bun scripts/send-rebrand-email.ts --limit 10
 *   bun scripts/send-rebrand-email.ts --rate 2
 *   bun scripts/send-rebrand-email.ts --allow-self-host
 */

import { parseArgs } from "node:util";
import { sendCampaign } from "@/lib/email/send-campaign";
import { env } from "@/lib/env";
import { buildRebrandCampaign } from "@/lib/hosted/campaigns/rebrand-announcement";

interface CliOptions {
    dryRun: boolean;
    limit?: number;
    onlyEmail?: string;
    ratePerSecond?: number;
    allowSelfHost: boolean;
}

/**
 * Strict integer parse: `Number.parseInt("10abc", 10)` silently
 * truncates to `10` instead of rejecting the malformed value.
 * `Number(...)` rejects any trailing garbage (returns NaN).
 */
function parseStrictInt(value: string): number {
    return Number(value);
}

function parseCli(): CliOptions {
    const parsed = parseArgs({
        options: {
            "dry-run": { type: "boolean", default: false },
            limit: { type: "string" },
            "only-email": { type: "string" },
            rate: { type: "string" },
            "allow-self-host": { type: "boolean", default: false },
        },
    });

    const limit = parsed.values.limit
        ? parseStrictInt(parsed.values.limit)
        : undefined;
    const ratePerSecond = parsed.values.rate
        ? parseStrictInt(parsed.values.rate)
        : undefined;

    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error(`--limit must be a positive integer (got ${limit})`);
    }
    if (
        ratePerSecond !== undefined &&
        (!Number.isInteger(ratePerSecond) ||
            ratePerSecond < 1 ||
            ratePerSecond > 100)
    ) {
        throw new Error(
            `--rate must be an integer between 1 and 100 (got ${ratePerSecond})`,
        );
    }

    return {
        dryRun: parsed.values["dry-run"] as boolean,
        limit,
        onlyEmail: parsed.values["only-email"] as string | undefined,
        ratePerSecond,
        allowSelfHost: parsed.values["allow-self-host"] as boolean,
    };
}

async function main(): Promise<void> {
    const options = parseCli();

    if (!env.IS_HOSTED && !options.allowSelfHost) {
        console.error(
            "[send-rebrand-email] refusing to run with IS_HOSTED unset.",
        );
        console.error(
            "  This script is intended for the Riffado-operated hosted instance.",
        );
        console.error(
            "  If you're testing locally, pass --allow-self-host to override.",
        );
        process.exit(1);
    }

    const campaign = buildRebrandCampaign();

    const controller = new AbortController();
    const onSignal = () => {
        console.error(
            "\n[send-rebrand-email] interrupted; finishing in-flight send...",
        );
        controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const result = await sendCampaign(campaign, {
        dryRun: options.dryRun,
        limit: options.limit,
        onlyEmail: options.onlyEmail,
        ratePerSecond: options.ratePerSecond,
        signal: controller.signal,
    });

    console.log("");
    console.log("=== send-rebrand-email summary ===");
    console.log(`  attempted: ${result.attempted}`);
    console.log(`  sent:      ${result.sent}`);
    console.log(`  failed:    ${result.failed}`);
    console.log(`  skipped:   ${result.skipped}`);
    console.log(`  pending:   ${result.pending}`);
    console.log(`  completed: ${result.completed}`);
    console.log("");
    if (result.failed > 0) {
        console.log(
            "  Note: see email_deliveries.error for per-recipient failure detail.",
        );
    }
    // An interrupted/incomplete run or any per-recipient failures must not
    // report success to cron/CI -- otherwise operational monitoring can't
    // tell a clean run from one that needs a re-run or investigation.
    if (!result.completed || result.failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error("[send-rebrand-email] fatal:", error);
    process.exit(1);
});
