import {
    findFreshValidations,
    upsertValidation,
} from "@/db/queries/email-validations";
import {
    checkEmail,
    isReacherConfigured,
    type ReacherResult,
} from "@/lib/email/reacher";
import type { CampaignDefinition } from "@/lib/email/types";

export interface ValidateOptions {
    maxAgeMs?: number;
    concurrency?: number;
    limit?: number;
    onlyEmail?: string;
    signal?: AbortSignal;
    log?: (message: string) => void;
}

export interface ValidateSummary {
    checked: number;
    cached: number;
    safe: number;
    risky: number;
    invalid: number;
    unknown: number;
    disposable: number;
    errors: number;
    skipped: number;
}

/**
 * Pre-flight validation pass for a campaign's audience. Walks the
 * audience, ensures each recipient has a fresh `email_validations`
 * row via Reacher. No-op when Reacher is not configured.
 */
export async function validateAudience(
    definition: CampaignDefinition,
    options: ValidateOptions = {},
): Promise<ValidateSummary> {
    const log = options.log ?? defaultLogger;
    const onlyEmail = options.onlyEmail?.toLowerCase();
    const limit = options.limit ?? 0;
    const maxAgeMs = options.maxAgeMs;
    const concurrency = Math.max(1, options.concurrency ?? 3);

    const summary: ValidateSummary = {
        checked: 0,
        cached: 0,
        safe: 0,
        risky: 0,
        invalid: 0,
        unknown: 0,
        disposable: 0,
        errors: 0,
        skipped: 0,
    };

    if (!isReacherConfigured()) {
        log(
            `[validate:${definition.slug}] REACHER_API_KEY unset; skipping pre-flight (campaign will proceed without validation)`,
        );
        return summary;
    }

    log(
        `[validate:${definition.slug}] start concurrency=${concurrency} limit=${limit || "none"}`,
    );

    const inFlight = new Map<string, Promise<void>>();
    let attempted = 0;

    const drainOne = async (): Promise<void> => {
        const next = inFlight.values().next().value;
        if (next) await next;
    };

    for await (const recipient of definition.audience()) {
        if (options.signal?.aborted) {
            log(`[validate:${definition.slug}] aborted by signal`);
            break;
        }
        if (limit > 0 && attempted >= limit) {
            log(`[validate:${definition.slug}] limit ${limit} reached`);
            break;
        }
        const email = recipient.email.toLowerCase();
        if (onlyEmail && email !== onlyEmail) continue;
        attempted += 1;

        const cached = await findFreshValidations([email], maxAgeMs);
        if (cached.has(email)) {
            summary.cached += 1;
            const row = cached.get(email);
            if (row) tallyResult(summary, row.reachable, row.isDisposable);
            continue;
        }

        while (inFlight.size >= concurrency) {
            await drainOne();
        }

        const probe = (async () => {
            try {
                const result = await checkEmail(email, {
                    signal: options.signal,
                });
                await persistResult(result);
                tallyResult(summary, result.reachable, result.isDisposable);
                summary.checked += 1;
                log(
                    `[validate:${definition.slug}] ${email} -> ${result.reachable}${result.isDisposable ? " disposable" : ""}`,
                );
            } catch (error) {
                summary.errors += 1;
                summary.skipped += 1;
                log(
                    `[validate:${definition.slug}] ${email} ERROR: ${describeError(error)}`,
                );
            } finally {
                inFlight.delete(email);
            }
        })();
        inFlight.set(email, probe);
    }

    while (inFlight.size > 0) {
        await drainOne();
    }

    log(
        `[validate:${definition.slug}] done checked=${summary.checked} cached=${summary.cached} safe=${summary.safe} risky=${summary.risky} invalid=${summary.invalid} unknown=${summary.unknown} disposable=${summary.disposable} errors=${summary.errors}`,
    );

    return summary;
}

async function persistResult(result: ReacherResult): Promise<void> {
    await upsertValidation({
        email: result.email,
        reachable: result.reachable,
        isDisposable: result.isDisposable,
        isRoleAccount: result.isRoleAccount,
        hasFullInbox: result.hasFullInbox,
        isCatchAll: result.isCatchAll,
        mxAccepts: result.mxAccepts,
        rawResponse: result.raw,
    });
}

function tallyResult(
    summary: ValidateSummary,
    reachable: "safe" | "risky" | "invalid" | "unknown",
    isDisposable: boolean,
): void {
    summary[reachable] += 1;
    if (isDisposable) summary.disposable += 1;
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return JSON.stringify(error);
}

function defaultLogger(message: string): void {
    console.log(message);
}
