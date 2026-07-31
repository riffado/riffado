import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import {
    commitMynahReservation,
    releaseMynahReservation,
    reserveMynah,
} from "@/lib/hosted/billing/enforcement";
import { captureServerException } from "@/lib/posthog-server";
import { createUserStorageProvider } from "@/lib/storage/factory";

/** Thrown when the user's Mynah second budget is exhausted for the cycle. */
export class MynahBudgetExhaustedError extends Error {
    constructor() {
        super("Mynah transcription budget exhausted for this cycle");
        this.name = "MynahBudgetExhaustedError";
    }
}

/**
 * True when Mynah is the fallback transcription provider for hosted users
 * who haven't configured their own key. Off on self-host and whenever the
 * base URL or service token is unset.
 */
export function isMynahConfigured(): boolean {
    return env.IS_HOSTED && !!env.MYNAH_BASE_URL && !!env.MYNAH_SERVICE_TOKEN;
}

export interface MynahTranscribeInput {
    userId: string;
    storagePath: string;
    /** Recording duration in milliseconds; drives the reserved second count. */
    durationMs: number;
    language?: string;
}

// Mirrors `PlaudClient`'s retry pattern (src/lib/plaud/client.ts) -- a
// transient gateway failure (Cloudflare 524 timeout, 502/503 during a
// deploy) shouldn't fail the whole transcription and burn the user's turn
// when a short retry would likely succeed.
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;

function isTransientStatus(status: number): boolean {
    return status === 502 || status === 503 || status === 504 || status === 524;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when `value` is an absolute http(s) URL Mynah can fetch on its own.
 * S3-style storage yields absolute presigned URLs; local storage yields a
 * relative, app-internal path (`/api/...`) that an external service can't
 * resolve -- Node's `fetch()` rejects it as "URL is invalid".
 */
function isFetchableUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

interface PostTranscriptionRequestInput {
    mynahBaseUrl: string;
    mynahServiceToken: string;
    userId: string;
    url: string;
    language?: string;
}

/**
 * POST the transcription request to Mynah, retrying transient gateway
 * failures (502/503/504/524) with exponential backoff before giving up.
 * Non-transient failures (4xx, or 5xx after retries are exhausted) throw
 * a status-only `Error` -- the upstream body can contain internal Mynah
 * diagnostics, so the detail is logged server-side only, not propagated
 * to the client.
 *
 * A 502/503/504/524 is ambiguous: the gateway timing out doesn't tell us
 * whether Mynah ever started (or finished) the work, so a naive retry can
 * duplicate billed transcription work server-side while we only keep one
 * local result/reservation. Every attempt for one logical request
 * (initial + retries) carries the same `idempotency-key` header so Mynah
 * can de-duplicate on its side; this is a client-side mitigation only --
 * it's a no-op unless Mynah's API honors the header, which this repo
 * can't verify (Mynah runs as a separate service, see AGENTS.md).
 */
async function postTranscriptionRequest(
    input: PostTranscriptionRequestInput,
): Promise<{ text?: string; language?: string | null }> {
    const { mynahBaseUrl, mynahServiceToken, userId, url, language } = input;
    const idempotencyKey = randomUUID();
    let attempt = 0;
    for (;;) {
        const res = await fetch(`${mynahBaseUrl}/v1/audio/transcriptions`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${mynahServiceToken}`,
                "content-type": "application/json",
                "x-riffado-user-id": userId,
                "idempotency-key": idempotencyKey,
            },
            body: JSON.stringify({
                url,
                response_format: "verbose_json",
                ...(language ? { language } : {}),
            }),
        });

        if (res.ok) {
            return (await res.json()) as {
                text?: string;
                language?: string | null;
            };
        }

        if (isTransientStatus(res.status) && attempt < MAX_RETRIES) {
            await res.text().catch(() => "");
            const delay = INITIAL_RETRY_DELAY_MS * 2 ** attempt;
            attempt += 1;
            console.warn(
                `[mynah] transcription request failed (${res.status}) for user ${userId}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
            );
            await sleep(delay);
            continue;
        }

        // The upstream body can contain internal Mynah diagnostics; this
        // error's message propagates all the way to the client via
        // transcribeRecording's catch block (result.error -> AppError
        // message -> JSON response), so log the detail server-side only
        // and throw a status-only message.
        const detail = await res.text().catch(() => "");
        console.error(
            `[mynah] transcription request failed (${res.status}) for user ${userId}: ${detail.slice(0, 2000)}`,
        );
        const upstreamError = new Error(
            `Mynah transcription failed (${res.status})`,
        );
        captureServerException(upstreamError, {
            source: "mynah",
            distinctId: userId,
            status: res.status,
        });
        throw upstreamError;
    }
}

/**
 * Transcribe a recording through the Mynah proxy. Reserves the recording's
 * duration against the user's Mynah counter, hands Mynah a short-lived
 * signed URL to the stored audio, and parses the OpenAI-shaped response.
 *
 * Reservation is committed on success and refunded on any failure, so a
 * crashed or rejected call never silently burns the user's budget.
 */
export async function transcribeViaMynah(
    input: MynahTranscribeInput,
): Promise<{ text: string; detectedLanguage: string | null }> {
    if (!isMynahConfigured()) {
        throw new Error("Mynah transcription is not configured");
    }

    const mynahBaseUrl = env.MYNAH_BASE_URL;
    const mynahServiceToken = env.MYNAH_SERVICE_TOKEN;
    if (!mynahBaseUrl || !mynahServiceToken) {
        throw new Error("Mynah transcription is not configured");
    }

    const seconds = Math.max(1, Math.ceil(input.durationMs / 1000));
    const reservation = await reserveMynah({ userId: input.userId, seconds });
    if (!reservation.reserved) {
        throw new MynahBudgetExhaustedError();
    }

    try {
        const storage = await createUserStorageProvider(input.userId);
        const url = await storage.getSignedUrl(input.storagePath, 3600);

        // Mynah fetches this URL itself, so it must be absolute and publicly
        // reachable. S3-style storage yields presigned URLs that satisfy this;
        // local storage yields a relative app path Mynah can't resolve. Fail
        // with a clear message here rather than leaking Node's opaque
        // "fetch() URL is invalid" from the Mynah 500. Self-host / local-storage
        // access to Mynah (direct upload) is planned separately.
        if (!isFetchableUrl(url)) {
            console.error(
                `[mynah] storage signed URL is not publicly fetchable for user ${input.userId}; Mynah requires object storage (S3). Got: ${url.slice(0, 120)}`,
            );
            const configError = new Error(
                "Mynah transcription requires object storage with publicly fetchable signed URLs (S3)",
            );
            captureServerException(configError, {
                source: "mynah",
                distinctId: input.userId,
                reason: "storage_not_fetchable",
            });
            throw configError;
        }

        const body = await postTranscriptionRequest({
            mynahBaseUrl,
            mynahServiceToken,
            userId: input.userId,
            url,
            language: input.language,
        });

        commitMynahReservation(reservation);
        return {
            text: body.text ?? "",
            detectedLanguage: body.language ?? null,
        };
    } catch (error) {
        await releaseMynahReservation(reservation);
        throw error;
    }
}
