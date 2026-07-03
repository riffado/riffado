import { ensureCampaign } from "@/db/queries/email-campaigns";
import {
    type CampaignSummary,
    claimDelivery,
    markDeliveryFailed,
    markDeliverySent,
    markDeliverySkipped,
    summarizeCampaign,
} from "@/db/queries/email-deliveries";
import { findSuppressedEmails } from "@/db/queries/email-suppressions";
import { findFreshValidations } from "@/db/queries/email-validations";
import { buildUnsubscribeHeaders } from "@/lib/email/headers";
import {
    htmlToText,
    resolveFromAddress,
    resolveReplyToAddress,
    SmtpNotConfiguredError,
    sendEmailWithHeaders,
} from "@/lib/email/transport";
import type { CampaignDefinition, Recipient } from "@/lib/email/types";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe-token";
import { env } from "@/lib/env";

export interface RunOptions {
    dryRun?: boolean;
    limit?: number;
    onlyEmail?: string;
    signal?: AbortSignal;
    ratePerSecond?: number;
    log?: (message: string) => void;
}

export interface RunResult extends CampaignSummary {
    completed: boolean;
}

/** Run a campaign end-to-end. Idempotent and resumable per recipient. */
export async function sendCampaign(
    definition: CampaignDefinition,
    options: RunOptions = {},
): Promise<RunResult> {
    const log = options.log ?? defaultLogger;
    const dryRun = options.dryRun ?? false;
    const ratePerSecond =
        options.ratePerSecond ?? env.EMAIL_SEND_RATE_PER_SECOND;
    const delayMs = ratePerSecond > 0 ? Math.ceil(1000 / ratePerSecond) : 0;
    const onlyEmail = options.onlyEmail?.toLowerCase();
    const limit = options.limit ?? 0;

    const campaign = await ensureCampaign({
        slug: definition.slug,
        subject: definition.subject,
        kind: definition.kind,
    });

    log(
        `[campaign:${campaign.slug}] start kind=${campaign.kind} dryRun=${dryRun} limit=${limit || "none"} rate=${ratePerSecond}/s`,
    );

    let attemptedNow = 0;
    let sentNow = 0;
    let failedNow = 0;
    let skippedNow = 0;
    let completed = true;

    for await (const recipient of definition.audience()) {
        if (options.signal?.aborted) {
            completed = false;
            log(`[campaign:${campaign.slug}] aborted by signal`);
            break;
        }

        if (limit > 0 && attemptedNow >= limit) {
            log(`[campaign:${campaign.slug}] limit ${limit} reached`);
            break;
        }

        const recipientEmail = recipient.email.toLowerCase();

        if (onlyEmail && recipientEmail !== onlyEmail) continue;

        attemptedNow += 1;

        if (dryRun) {
            log(
                `[campaign:${campaign.slug}] DRY ${recipient.kind}:${recipient.id} ${recipientEmail}`,
            );
            continue;
        }

        if (campaign.kind !== "transactional") {
            const suppressed = await findSuppressedEmails([recipientEmail]);
            if (suppressed.has(recipientEmail)) {
                const claim = await claimDelivery({
                    campaignId: campaign.id,
                    email: recipientEmail,
                    userId: recipient.kind === "user" ? recipient.id : null,
                    subscriberId:
                        recipient.kind === "subscriber" ? recipient.id : null,
                });
                if (claim) {
                    await markDeliverySkipped(
                        claim.id,
                        "skipped_suppressed",
                        undefined,
                    );
                }
                skippedNow += 1;
                continue;
            }
        }

        if (
            campaign.kind === "marketing" &&
            recipient.kind === "user" &&
            recipient.marketingConsent !== true
        ) {
            const claim = await claimDelivery({
                campaignId: campaign.id,
                email: recipientEmail,
                userId: recipient.id,
                subscriberId: null,
            });
            if (claim) {
                await markDeliverySkipped(
                    claim.id,
                    "skipped_no_consent",
                    undefined,
                );
            }
            skippedNow += 1;
            continue;
        }

        if (campaign.kind !== "transactional") {
            const validations = await findFreshValidations([recipientEmail]);
            const validation = validations.get(recipientEmail);
            if (validation) {
                const block =
                    validation.reachable === "invalid" ||
                    (campaign.kind === "marketing" && validation.isDisposable);
                if (block) {
                    const claim = await claimDelivery({
                        campaignId: campaign.id,
                        email: recipientEmail,
                        userId: recipient.kind === "user" ? recipient.id : null,
                        subscriberId:
                            recipient.kind === "subscriber"
                                ? recipient.id
                                : null,
                    });
                    if (claim) {
                        await markDeliverySkipped(
                            claim.id,
                            "skipped_invalid_email",
                            `reachable=${validation.reachable} disposable=${validation.isDisposable}`,
                        );
                    }
                    skippedNow += 1;
                    continue;
                }
            }
        }

        const claim = await claimDelivery({
            campaignId: campaign.id,
            email: recipientEmail,
            userId: recipient.kind === "user" ? recipient.id : null,
            subscriberId: recipient.kind === "subscriber" ? recipient.id : null,
        });
        if (!claim) {
            attemptedNow -= 1;
            continue;
        }

        try {
            const unsubscribeUrl =
                campaign.kind === "transactional"
                    ? null
                    : buildUnsubscribeUrl(recipient.kind, recipient.id);

            const rendered = await definition.render(recipient, unsubscribeUrl);
            const text = rendered.text ?? htmlToText(rendered.html);

            const from = resolveFromAddress(
                campaign.kind,
                definition.fromAddress,
            );
            const headers =
                unsubscribeUrl !== null
                    ? buildUnsubscribeHeaders(unsubscribeUrl)
                    : undefined;

            const messageId = await sendEmailWithHeaders({
                to: recipientEmail,
                from,
                replyTo: resolveReplyToAddress(),
                subject: campaign.subject,
                html: rendered.html,
                text,
                headers,
            });

            await markDeliverySent(claim.id, messageId);
            sentNow += 1;
            log(
                `[campaign:${campaign.slug}] sent ${recipient.kind}:${recipient.id} ${recipientEmail}${messageId ? ` mid=${messageId}` : ""}`,
            );
        } catch (error) {
            failedNow += 1;
            const message =
                error instanceof SmtpNotConfiguredError
                    ? "SMTP not configured"
                    : describeError(error);
            await markDeliveryFailed(claim.id, message);
            log(
                `[campaign:${campaign.slug}] FAILED ${recipient.kind}:${recipient.id} ${recipientEmail} -- ${message}`,
            );
            if (error instanceof SmtpNotConfiguredError) {
                completed = false;
                break;
            }
        }

        if (delayMs > 0) await sleep(delayMs);
    }

    const summary = await summarizeCampaign(campaign.id);
    log(
        `[campaign:${campaign.slug}] done attempted=${summary.attempted} sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped} pending=${summary.pending} (this run: attempted=${attemptedNow} sent=${sentNow} failed=${failedNow} skipped=${skippedNow})`,
    );

    return { ...summary, completed };
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return JSON.stringify(error);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLogger(message: string): void {
    console.log(message);
}

export type { Recipient };
