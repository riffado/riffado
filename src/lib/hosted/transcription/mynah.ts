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
 * service token is unset.
 */
export function isMynahConfigured(): boolean {
    return env.IS_HOSTED && !!env.MYNAH_SERVICE_TOKEN;
}

export interface MynahTranscribeInput {
    userId: string;
    storagePath: string;
    /** Recording duration in milliseconds; drives the reserved second count. */
    durationMs: number;
    language?: string;
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
    const seconds = Math.max(1, Math.ceil(input.durationMs / 1000));
    const reservation = await reserveMynah({ userId: input.userId, seconds });
    if (!reservation.reserved) {
        throw new MynahBudgetExhaustedError();
    }

    try {
        const storage = await createUserStorageProvider(input.userId);
        const url = await storage.getSignedUrl(input.storagePath, 3600);

        const res = await fetch(
            `${env.MYNAH_BASE_URL}/v1/audio/transcriptions`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${env.MYNAH_SERVICE_TOKEN}`,
                    "content-type": "application/json",
                    "x-riffado-user-id": input.userId,
                },
                body: JSON.stringify({
                    url,
                    response_format: "verbose_json",
                    ...(input.language ? { language: input.language } : {}),
                }),
            },
        );

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
