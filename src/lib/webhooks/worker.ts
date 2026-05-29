import type { IncomingMessage, RequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { and, eq, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import {
    createOutboundWebhookPayload,
    createStoredWebhookPayload,
    createUnavailableWebhookPayload,
    getWebhookPayloadDeliveredAt,
    getWebhookPayloadError,
    getWebhookPayloadRecordingId,
    type StoredWebhookPayload,
} from "@/lib/webhooks/payload";
import { getWebhookRecordingDetailForUser } from "@/lib/webhooks/recording";
import {
    decryptWebhookSecret,
    decryptWebhookUrl,
} from "@/lib/webhooks/secrets";
import { formatWebhookSignatureHeader } from "@/lib/webhooks/signature";
import {
    isWebhookUrlPolicyError,
    type PublicWebhookAddress,
    type PublicWebhookTarget,
    resolveWebhookUrl,
} from "@/lib/webhooks/url";

const TICK_MS = 30_000;
const DELIVERY_LIMIT = 50;
const PER_USER_DELIVERY_LIMIT = 10;
const TIMEOUT_MS = 10_000;
const PROCESSING_LEASE_MS = 15 * 60_000;
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;

let started = false;
let running = false;

type WebhookDeliveryResult = {
    ok: boolean;
    responseStatus: number | null;
    responseBody: string | null;
    error: string | null;
    storedPayload: StoredWebhookPayload;
    permanentFailure?: boolean;
};

type ClaimedDelivery = {
    delivery: typeof webhookDeliveries.$inferSelect;
    endpoint: typeof webhookEndpoints.$inferSelect;
};

type CandidateDeliveryRow = {
    id: string;
};

type QueryResultRows<T> = T[] | { rows: T[] };

export function getWebhookBackoffMs(attemptNumber: number): number {
    return BACKOFF_MS[
        Math.min(Math.max(attemptNumber, 1), BACKOFF_MS.length) - 1
    ];
}

function rowsFromQueryResult<T>(result: QueryResultRows<T>): T[] {
    return Array.isArray(result) ? result : result.rows;
}

function dueDeliveryPredicate(now: Date): SQL {
    return or(
        and(
            eq(webhookDeliveries.status, "pending"),
            lte(webhookDeliveries.nextAttemptAt, now),
        ),
        and(
            eq(webhookDeliveries.status, "processing"),
            lte(webhookDeliveries.nextAttemptAt, now),
        ),
    ) as SQL;
}

async function readResponseBody(response: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
            if (body.length < 4096) {
                body += chunk.slice(0, 4096 - body.length);
            }
        });
        response.on("end", () => resolve(body));
        response.on("error", () => resolve(body));
    });
}

function createPinnedLookup(addresses: PublicWebhookAddress[]): LookupFunction {
    return (_hostname, options, callback) => {
        if (options.all) {
            callback(null, addresses);
            return;
        }

        const family =
            options.family === 4 || options.family === 6
                ? options.family
                : null;
        const selected =
            (family
                ? addresses.find((address) => address.family === family)
                : undefined) ?? addresses[0];
        callback(null, selected.address, selected.family);
    };
}

async function postWebhookRequest(
    target: PublicWebhookTarget,
    headers: Record<string, string>,
    body: string,
): Promise<{
    ok: boolean;
    responseStatus: number | null;
    responseBody: string | null;
    error: string | null;
}> {
    const hostname = target.url.hostname.replace(/^\[(.*)\]$/, "$1");
    const options: RequestOptions = {
        protocol: target.url.protocol,
        hostname,
        port: target.url.port || undefined,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        headers,
    };
    if (target.addresses) {
        options.lookup = createPinnedLookup(target.addresses);
    }
    const requestFn =
        target.url.protocol === "http:" ? httpRequest : httpsRequest;

    return new Promise((resolve) => {
        const request = requestFn(options, async (response) => {
            const status = response.statusCode ?? 0;
            const responseBody = await readResponseBody(response);
            const ok = status >= 200 && status < 300;

            resolve({
                ok,
                responseStatus: status || null,
                responseBody,
                error: ok ? null : `HTTP ${status}`,
            });
        });

        const timeout = setTimeout(() => {
            request.destroy(new Error("Webhook delivery timed out"));
        }, TIMEOUT_MS);

        request.on("error", (error) => {
            clearTimeout(timeout);
            resolve({
                ok: false,
                responseStatus: null,
                responseBody: null,
                error: error instanceof Error ? error.message : String(error),
            });
        });
        request.on("close", () => clearTimeout(timeout));
        request.write(body);
        request.end();
    });
}

async function postDelivery(
    delivery: typeof webhookDeliveries.$inferSelect,
    endpoint: typeof webhookEndpoints.$inferSelect,
): Promise<WebhookDeliveryResult> {
    const recordingId =
        delivery.recordingId ?? getWebhookPayloadRecordingId(delivery.payload);
    const deliveredAt = getWebhookPayloadDeliveredAt(
        delivery.payload,
        delivery.createdAt,
    );
    const payloadError = getWebhookPayloadError(delivery.payload);
    const storedPayload = recordingId
        ? createStoredWebhookPayload(delivery.event, recordingId, {
              deliveredAt,
              error: payloadError ?? undefined,
          })
        : createUnavailableWebhookPayload(
              null,
              "Webhook delivery has no recording reference",
          );

    if (!recordingId) {
        return {
            ok: false,
            responseStatus: null,
            responseBody: null,
            error: "Webhook delivery has no recording reference",
            storedPayload,
            permanentFailure: true,
        };
    }

    const timestamp = Math.floor(Date.now() / 1000);

    try {
        const target = await resolveWebhookUrl(decryptWebhookUrl(endpoint.url));
        const recording = await getWebhookRecordingDetailForUser(
            delivery.userId,
            recordingId,
            delivery.event,
        );
        if (!recording) {
            return {
                ok: false,
                responseStatus: null,
                responseBody: null,
                error: "Recording is no longer available",
                storedPayload: createUnavailableWebhookPayload(
                    recordingId,
                    "Recording is no longer available",
                ),
                permanentFailure: true,
            };
        }

        const body = JSON.stringify(
            createOutboundWebhookPayload(
                delivery.event,
                deliveredAt,
                recording,
                payloadError,
            ),
        );
        const secret = decryptWebhookSecret(endpoint.secret);
        const result = await postWebhookRequest(
            target,
            {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body).toString(),
                "User-Agent": "Riffado-Webhooks/1",
                "X-Riffado-Event": delivery.event,
                "X-Riffado-Delivery": delivery.id,
                "X-Riffado-Timestamp": String(timestamp),
                "X-Riffado-Signature": formatWebhookSignatureHeader(
                    secret,
                    timestamp,
                    body,
                ),
            },
            body,
        );

        return { ...result, storedPayload };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            responseStatus: null,
            responseBody: null,
            error: message,
            storedPayload,
            permanentFailure: isWebhookUrlPolicyError(message),
        };
    }
}

async function markDeliveryAttempt(
    delivery: typeof webhookDeliveries.$inferSelect,
    endpoint: typeof webhookEndpoints.$inferSelect,
    result: Awaited<ReturnType<typeof postDelivery>>,
): Promise<void> {
    const now = new Date();
    const attempts = delivery.attempts + 1;

    if (result.ok) {
        await db.transaction(async (tx) => {
            const [updatedDelivery] = await tx
                .update(webhookDeliveries)
                .set({
                    status: "success",
                    payload: result.storedPayload,
                    attempts,
                    lastAttemptAt: now,
                    lastResponseStatus: result.responseStatus,
                    lastResponseBody: result.responseBody,
                    lastError: null,
                    updatedAt: now,
                })
                .where(
                    and(
                        eq(webhookDeliveries.id, delivery.id),
                        eq(webhookDeliveries.userId, delivery.userId),
                        eq(webhookDeliveries.status, "processing"),
                    ),
                )
                .returning({ id: webhookDeliveries.id });

            if (!updatedDelivery) return;

            await tx
                .update(webhookEndpoints)
                .set({
                    lastDeliveryAt: now,
                    lastDeliveryStatus: "success",
                    updatedAt: now,
                })
                .where(
                    and(
                        eq(webhookEndpoints.id, endpoint.id),
                        eq(webhookEndpoints.userId, endpoint.userId),
                    ),
                );
        });
        return;
    }

    const dead = result.permanentFailure || attempts > BACKOFF_MS.length;
    const nextAttemptAt = dead
        ? now
        : new Date(now.getTime() + getWebhookBackoffMs(attempts));

    await db.transaction(async (tx) => {
        const [updatedDelivery] = await tx
            .update(webhookDeliveries)
            .set({
                status: dead ? "dead" : "pending",
                payload: result.storedPayload,
                attempts,
                lastAttemptAt: now,
                nextAttemptAt,
                lastResponseStatus: result.responseStatus,
                lastResponseBody: result.responseBody,
                lastError: result.error,
                updatedAt: now,
            })
            .where(
                and(
                    eq(webhookDeliveries.id, delivery.id),
                    eq(webhookDeliveries.userId, delivery.userId),
                    eq(webhookDeliveries.status, "processing"),
                ),
            )
            .returning({ id: webhookDeliveries.id });

        if (!updatedDelivery) return;

        await tx
            .update(webhookEndpoints)
            .set({
                lastDeliveryAt: now,
                lastDeliveryStatus: "failed",
                updatedAt: now,
            })
            .where(
                and(
                    eq(webhookEndpoints.id, endpoint.id),
                    eq(webhookEndpoints.userId, endpoint.userId),
                ),
            );
    });
}

async function claimDueWebhookDeliveries(): Promise<ClaimedDelivery[]> {
    const now = new Date();
    // postgres-js binds Date → timestamp parameters reliably when the
    // Date sits behind a Drizzle column predicate, but raw sql`...` with
    // Date placeholders crashes under Bun/Next 16 with
    // ERR_INVALID_ARG_TYPE ("Received an instance of Date"). Cast the
    // ISO string explicitly to `timestamp` to match the column type
    // (`webhookDeliveries.nextAttemptAt` is `timestamp`, not
    // `timestamptz`); using `::timestamptz` would force a timezone
    // conversion on every comparison and skew the due window in any
    // non-UTC server timezone.
    const nowParam = sql`${now.toISOString()}::timestamp`;

    const candidateResult = await db.execute(sql`
        select id
        from (
            select
                ${webhookDeliveries.id} as id,
                ${webhookDeliveries.nextAttemptAt} as next_attempt_at,
                row_number() over (
                    partition by ${webhookDeliveries.userId}
                    order by ${webhookDeliveries.nextAttemptAt} asc, ${webhookDeliveries.id} asc
                ) as user_rank
            from ${webhookDeliveries}
            inner join ${webhookEndpoints}
                on ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
            where (
                (${webhookDeliveries.status} = 'pending' and ${webhookDeliveries.nextAttemptAt} <= ${nowParam})
                or (${webhookDeliveries.status} = 'processing' and ${webhookDeliveries.nextAttemptAt} <= ${nowParam})
            )
            and ${webhookEndpoints.enabled} = true
        ) ranked_deliveries
        where user_rank <= ${PER_USER_DELIVERY_LIMIT}
        order by next_attempt_at asc, id asc
        limit ${DELIVERY_LIMIT}
    `);

    const candidateRows = rowsFromQueryResult(
        candidateResult as unknown as QueryResultRows<CandidateDeliveryRow>,
    );

    if (candidateRows.length === 0) return [];

    const ids = candidateRows.map((row) => row.id);
    const claimExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);
    const claimedRows = await db
        .update(webhookDeliveries)
        .set({
            status: "processing",
            nextAttemptAt: claimExpiresAt,
            updatedAt: now,
        })
        .where(
            and(
                inArray(webhookDeliveries.id, ids),
                dueDeliveryPredicate(now),
                sql`exists (
                    select 1
                    from ${webhookEndpoints}
                    where ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
                    and ${webhookEndpoints.enabled} = true
                )`,
            ),
        )
        .returning({ id: webhookDeliveries.id });

    const claimedIds = new Set(claimedRows.map((row) => row.id));
    if (claimedIds.size === 0) return [];

    const rows = await db
        .select({
            delivery: webhookDeliveries,
            endpoint: webhookEndpoints,
        })
        .from(webhookDeliveries)
        .innerJoin(
            webhookEndpoints,
            eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        )
        .where(
            and(
                inArray(webhookDeliveries.id, Array.from(claimedIds)),
                eq(webhookEndpoints.enabled, true),
            ),
        );

    const order = new Map(ids.map((id, index) => [id, index]));
    return rows.sort((a, b) => {
        return (
            (order.get(a.delivery.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.delivery.id) ?? Number.MAX_SAFE_INTEGER)
        );
    });
}

async function reloadClaimedDeliveryForSend(
    claimed: ClaimedDelivery,
): Promise<ClaimedDelivery | null> {
    const [row] = await db
        .select({
            delivery: webhookDeliveries,
            endpoint: webhookEndpoints,
        })
        .from(webhookDeliveries)
        .innerJoin(
            webhookEndpoints,
            eq(webhookEndpoints.id, webhookDeliveries.endpointId),
        )
        .where(
            and(
                eq(webhookDeliveries.id, claimed.delivery.id),
                eq(webhookDeliveries.userId, claimed.delivery.userId),
                eq(webhookDeliveries.endpointId, claimed.endpoint.id),
                eq(webhookDeliveries.status, "processing"),
                eq(webhookEndpoints.id, claimed.endpoint.id),
                eq(webhookEndpoints.userId, claimed.endpoint.userId),
                eq(webhookEndpoints.enabled, true),
            ),
        )
        .limit(1);

    return row ?? null;
}

async function releaseClaimedDelivery(
    delivery: typeof webhookDeliveries.$inferSelect,
): Promise<void> {
    const now = new Date();
    await db
        .update(webhookDeliveries)
        .set({
            status: "pending",
            nextAttemptAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(webhookDeliveries.id, delivery.id),
                eq(webhookDeliveries.userId, delivery.userId),
                eq(webhookDeliveries.status, "processing"),
            ),
        );
}

export async function deliverDueWebhooks(): Promise<void> {
    if (running) return;
    running = true;

    try {
        const rows = await claimDueWebhookDeliveries();

        for (const row of rows) {
            const current = await reloadClaimedDeliveryForSend(row);
            if (!current) {
                await releaseClaimedDelivery(row.delivery);
                continue;
            }

            const result = await postDelivery(
                current.delivery,
                current.endpoint,
            );
            await markDeliveryAttempt(
                current.delivery,
                current.endpoint,
                result,
            );
        }
    } catch (error) {
        console.error("Webhook delivery worker failed:", error);
    } finally {
        running = false;
    }
}

export function signalWebhookWorker(): void {
    if (!started) return;
    void deliverDueWebhooks();
}

export function startWebhookWorker(): void {
    if (started) return;
    started = true;
    const interval = setInterval(() => {
        void deliverDueWebhooks();
    }, TICK_MS);
    interval.unref?.();
    void deliverDueWebhooks();
}
