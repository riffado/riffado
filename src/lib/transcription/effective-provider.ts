import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";
import { isRiffadoIncludedProviderId } from "@/lib/transcription/included-provider";

/**
 * Outcome of the transcription provider selection rule.
 *
 * - `managed`: the managed Mynah provider handles the call.
 * - `credential`: a user credential handles it. `credentialId` is the
 *   requested `api_credentials` id, or `null` when the user's legacy
 *   default-transcription row applies.
 * - `none`: no provider resolves, so the call fails with
 *   `NO_TRANSCRIPTION_PROVIDER`.
 */
export type TranscriptionProviderSelection =
    | { kind: "managed" }
    | { kind: "credential"; credentialId: string | null }
    | { kind: "none" };

export interface TranscriptionProviderSelectionInput {
    /** Explicit provider id for this call; wins over the stored pointer. */
    explicitProviderId?: string | null;
    /** `userSettings.defaultTranscriptionProviderId`. */
    pointer: string | null;
    /** Whether the user has an `isDefaultTranscription` credential row. */
    hasLegacyDefaultCredential: boolean;
}

/**
 * The single provider selection rule: explicit provider id, then the stored
 * pointer, then the legacy default credential, then Mynah when the instance
 * has it configured. The `riffado-included` sentinel selects Mynah. An id
 * that is not the sentinel always selects a credential, so a credential that
 * no longer resolves never falls back to Mynah. Mynah is only ever selected
 * when `isMynahConfigured()` holds, which keeps self-host out of it.
 */
export function selectTranscriptionProvider(
    input: TranscriptionProviderSelectionInput,
): TranscriptionProviderSelection {
    const requested = input.explicitProviderId || input.pointer || null;
    if (isRiffadoIncludedProviderId(requested)) {
        return isMynahConfigured() ? { kind: "managed" } : { kind: "none" };
    }
    if (requested) {
        return { kind: "credential", credentialId: requested };
    }
    if (input.hasLegacyDefaultCredential) {
        return { kind: "credential", credentialId: null };
    }
    return isMynahConfigured() ? { kind: "managed" } : { kind: "none" };
}

/**
 * True when a transcription for this user without an explicit provider id
 * runs on the managed Mynah provider. Reads nothing from the database on
 * self-host or when the pointer already decides the outcome.
 */
export async function transcriptionRunsOnMynah(
    userId: string,
    pointer: string | null,
): Promise<boolean> {
    if (!isMynahConfigured()) return false;

    let hasLegacyDefaultCredential = false;
    if (!pointer) {
        const [legacyDefault] = await db
            .select({ id: apiCredentials.id })
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);
        hasLegacyDefaultCredential = Boolean(legacyDefault);
    }

    return (
        selectTranscriptionProvider({ pointer, hasLegacyDefaultCredential })
            .kind === "managed"
    );
}
