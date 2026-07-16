/**
 * Send the launch-day Hosted Pro transition notice to grandfathered users.
 *
 * Safe by default: without `--send`, this only reports the eligible cohort.
 * Sends are once-only through the `transition_start` email-log key, so an
 * interrupted run can be resumed without mailing successful recipients twice.
 *
 * Usage:
 *   bun scripts/send-hosted-pro-launch-email.ts
 *   bun scripts/send-hosted-pro-launch-email.ts --only-email=user@example.com --send
 *   bun scripts/send-hosted-pro-launch-email.ts --limit=25 --rate=2 --send
 *   bun scripts/send-hosted-pro-launch-email.ts --send
 */

import { parseArgs } from "node:util";
import { and, asc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { getFoundingMemberAvailability } from "@/db/queries/billing";
import { hasEmailSend } from "@/db/queries/email-log";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import {
    displayAmountForCurrency,
    displayStandardAmountForCurrency,
    resolveCurrency,
} from "@/lib/hosted/billing/pricing";
import { sendTransitionStartEmail } from "@/lib/notifications/email";

const EMAIL_KIND = "transition_start";
const SELF_HOST_URL = "https://github.com/riffado/riffado#self-hosting";

interface CliOptions {
    send: boolean;
    limit?: number;
    onlyEmail?: string;
    ratePerSecond: number;
    allowSelfHost: boolean;
}

function parsePositiveInteger(value: string, flag: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer (got ${value})`);
    }
    return parsed;
}

function parseCli(): CliOptions {
    const parsed = parseArgs({
        options: {
            send: { type: "boolean", default: false },
            limit: { type: "string" },
            "only-email": { type: "string" },
            rate: { type: "string" },
            "allow-self-host": { type: "boolean", default: false },
        },
    });

    const limit = parsed.values.limit
        ? parsePositiveInteger(parsed.values.limit, "--limit")
        : undefined;
    const ratePerSecond = parsed.values.rate
        ? parsePositiveInteger(parsed.values.rate, "--rate")
        : env.EMAIL_SEND_RATE_PER_SECOND;
    if (ratePerSecond > 100) {
        throw new Error(`--rate must not exceed 100 (got ${ratePerSecond})`);
    }

    const onlyEmail = parsed.values["only-email"]?.trim().toLowerCase();
    if (parsed.values["only-email"] !== undefined && !onlyEmail) {
        throw new Error("--only-email must not be empty");
    }

    return {
        send: parsed.values.send,
        limit,
        onlyEmail,
        ratePerSecond,
        allowSelfHost: parsed.values["allow-self-host"],
    };
}

async function main(): Promise<void> {
    const options = parseCli();

    if (!env.IS_HOSTED && !options.allowSelfHost) {
        throw new Error(
            "refusing to run with IS_HOSTED unset; use --allow-self-host only for local testing",
        );
    }
    if (options.send && !env.BILLING_ENABLED) {
        throw new Error("refusing to send while BILLING_ENABLED is false");
    }
    if (!env.APP_URL) {
        throw new Error("APP_URL is required to build email links");
    }
    if (!env.BILLING_LAUNCH_DATE) {
        throw new Error("BILLING_LAUNCH_DATE is required");
    }

    const launchAt = new Date(`${env.BILLING_LAUNCH_DATE}T00:00:00Z`);
    if (options.send && new Date() < launchAt) {
        throw new Error(
            `refusing to send before BILLING_LAUNCH_DATE (${env.BILLING_LAUNCH_DATE})`,
        );
    }

    const filters = [
        eq(users.plan, "hosted_free"),
        isNotNull(users.planTransitionUntil),
        gt(users.planTransitionUntil, new Date()),
        isNull(users.accountDeletionScheduledAt),
        ne(users.email, ""),
    ];
    if (options.onlyEmail) {
        filters.push(sql`lower(${users.email}) = ${options.onlyEmail}`);
    }

    const cohort = await db
        .select({
            id: users.id,
            email: users.email,
            transitionUntil: users.planTransitionUntil,
        })
        .from(users)
        .where(and(...filters))
        .orderBy(asc(users.id))
        .limit(options.limit ?? 1_000_000);

    const foundingAvailability = await getFoundingMemberAvailability(
        env.BILLING_FOUNDING_MEMBER_CAPACITY,
    );
    const foundingOfferAvailable = foundingAvailability.remaining > 0;
    const monthlyKind = foundingOfferAvailable ? "founding" : "standard";
    const currency = resolveCurrency(null, "month", monthlyKind);
    const amountValue = foundingOfferAvailable
        ? displayAmountForCurrency(currency)
        : displayStandardAmountForCurrency(currency);
    const amountCurrency = currency.toUpperCase();
    const baseUrl = env.APP_URL.replace(/\/$/, "");

    let eligible = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let interrupted = false;
    const controller = new AbortController();
    const onSignal = () => {
        interrupted = true;
        controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    for (const row of cohort) {
        if (controller.signal.aborted) break;
        if (!row.transitionUntil) continue;

        const key = { userId: row.id, kind: EMAIL_KIND };
        if (await hasEmailSend(key)) {
            skipped += 1;
            continue;
        }
        eligible += 1;
        if (!options.send) continue;

        try {
            const didSend = await sendTransitionStartEmail({
                userId: row.id,
                email: row.email,
                transitionEndsAt: row.transitionUntil,
                amountValue,
                amountCurrency,
                foundingOfferAvailable,
                foundingCapacity: foundingAvailability.capacity,
                billingUrl: `${baseUrl}/settings#billing`,
                exportUrl: `${baseUrl}/settings#export`,
                selfHostUrl: SELF_HOST_URL,
            });
            if (didSend) {
                sent += 1;
            } else if (await hasEmailSend(key)) {
                skipped += 1;
            } else {
                failed += 1;
            }
        } catch (error) {
            failed += 1;
            console.error(
                `[send-hosted-pro-launch-email] recipient ${row.id} failed:`,
                error,
            );
        }

        if (options.ratePerSecond > 0) {
            await new Promise((resolve) =>
                setTimeout(resolve, Math.ceil(1000 / options.ratePerSecond)),
            );
        }
    }

    console.log("=== Hosted Pro launch email ===");
    console.log(`mode:       ${options.send ? "SEND" : "DRY RUN"}`);
    console.log(`cohort:     ${cohort.length}`);
    console.log(`eligible:   ${eligible}`);
    console.log(`sent:       ${sent}`);
    console.log(`skipped:    ${skipped}`);
    console.log(`failed:     ${failed}`);
    console.log(`interrupted:${interrupted ? " yes" : " no"}`);
    console.log(
        `offer:      ${foundingOfferAvailable ? `${foundingAvailability.remaining} founding spots currently available` : "standard monthly pricing"}`,
    );

    if (!options.send) {
        console.log("No email was sent. Re-run with --send after verification.");
    }
    if (failed > 0 || interrupted) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error("[send-hosted-pro-launch-email] fatal:", error);
        process.exitCode = 1;
    })
    .finally(() => {
        process.exit(process.exitCode ?? 0);
    });
