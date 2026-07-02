/**
 * Pre-flight email validation for the rebrand audience.
 *
 * Usage:
 *   bun scripts/validate-rebrand-audience.ts
 *   bun scripts/validate-rebrand-audience.ts --limit 50
 *   bun scripts/validate-rebrand-audience.ts --only-email me@x
 *   bun scripts/validate-rebrand-audience.ts --max-age-days 30
 *   bun scripts/validate-rebrand-audience.ts --allow-self-host
 */

import { parseArgs } from "node:util";
import { isReacherConfigured } from "@/lib/email/reacher";
import { validateAudience } from "@/lib/email/validate-audience";
import { env } from "@/lib/env";
import { buildRebrandCampaign } from "@/lib/hosted/campaigns/rebrand-announcement";

interface CliOptions {
    limit?: number;
    onlyEmail?: string;
    maxAgeDays: number;
    allowSelfHost: boolean;
    concurrency: number;
}

function parseCli(): CliOptions {
    const parsed = parseArgs({
        options: {
            limit: { type: "string" },
            "only-email": { type: "string" },
            "max-age-days": { type: "string", default: "90" },
            "allow-self-host": { type: "boolean", default: false },
            concurrency: { type: "string", default: "3" },
        },
    });

    const limit = parsed.values.limit
        ? Number.parseInt(parsed.values.limit, 10)
        : undefined;
    const maxAgeDays = Number.parseInt(
        parsed.values["max-age-days"] as string,
        10,
    );
    const concurrency = Number.parseInt(
        parsed.values.concurrency as string,
        10,
    );

    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error(`--limit must be a positive integer (got ${limit})`);
    }
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) {
        throw new Error(
            `--max-age-days must be a positive integer (got ${maxAgeDays})`,
        );
    }
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error(
            `--concurrency must be a positive integer (got ${concurrency})`,
        );
    }

    return {
        limit,
        onlyEmail: parsed.values["only-email"] as string | undefined,
        maxAgeDays,
        allowSelfHost: parsed.values["allow-self-host"] as boolean,
        concurrency,
    };
}

async function main(): Promise<void> {
    const options = parseCli();

    if (!env.IS_HOSTED && !options.allowSelfHost) {
        console.error(
            "[validate-rebrand-audience] refusing to run with IS_HOSTED unset.",
        );
        console.error(
            "  This script is intended for the Riffado-operated hosted instance.",
        );
        console.error(
            "  If you're testing locally, pass --allow-self-host to override.",
        );
        process.exit(1);
    }

    if (!isReacherConfigured()) {
        console.error(
            "[validate-rebrand-audience] REACHER_API_KEY is not set; cannot run validation.",
        );
        process.exit(1);
    }

    const campaign = buildRebrandCampaign();
    const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1000;

    const controller = new AbortController();
    const onSignal = () => {
        console.error(
            "\n[validate-rebrand-audience] interrupted; finishing in-flight probes...",
        );
        controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const summary = await validateAudience(campaign, {
        limit: options.limit,
        onlyEmail: options.onlyEmail,
        maxAgeMs,
        concurrency: options.concurrency,
        signal: controller.signal,
    });

    console.log("");
    console.log("=== validate-rebrand-audience summary ===");
    console.log(`  checked (new probes): ${summary.checked}`);
    console.log(`  cached (already fresh): ${summary.cached}`);
    console.log(`  safe:       ${summary.safe}`);
    console.log(`  risky:      ${summary.risky}`);
    console.log(`  invalid:    ${summary.invalid}`);
    console.log(`  unknown:    ${summary.unknown}`);
    console.log(`  disposable: ${summary.disposable}`);
    console.log(`  errors:     ${summary.errors}`);
    console.log("");
}

main().catch((error) => {
    console.error("[validate-rebrand-audience] fatal:", error);
    process.exit(1);
});
