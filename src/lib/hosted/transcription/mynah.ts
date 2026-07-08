import { env } from "@/lib/env";
import {
    commitMynahReservation,
    releaseMynahReservation,
    reserveMynah,
} from "@/lib/hosted/billing/enforcement";
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
            throw new Error(
                "Mynah transcription requires object storage with publicly fetchable signed URLs (S3)",
            );
        }

        const res = await fetch(`${mynahBaseUrl}/v1/audio/transcriptions`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${mynahServiceToken}`,
                "content-type": "application/json",
                "x-riffado-user-id": input.userId,
            },
            body: JSON.stringify({
                url,
                response_format: "verbose_json",
                ...(input.language ? { language: input.language } : {}),
            }),
        });

        if (!res.ok) {
            // The upstream body can contain internal Mynah diagnostics; this
            // error's message propagates all the way to the client via
            // transcribeRecording's catch block (result.error -> AppError
            // message -> JSON response), so log the detail server-side only
            // and throw a status-only message.
            const detail = await res.text().catch(() => "");
            console.error(
                `[mynah] transcription request failed (${res.status}) for user ${input.userId}: ${detail.slice(0, 2000)}`,
            );
            throw new Error(`Mynah transcription failed (${res.status})`);
        }

        const body = (await res.json()) as {
            text?: string;
            language?: string | null;
        };

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
