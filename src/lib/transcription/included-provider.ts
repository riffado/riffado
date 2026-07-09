import { getEntitlements } from "@/lib/entitlements";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";

/**
 * Reserved id for the managed, Riffado-included transcription provider.
 *
 * Unlike user-configured providers this is NOT a row in `api_credentials`;
 * it's a synthetic entry surfaced in the Providers list and stored as the
 * sentinel value of `userSettings.defaultTranscriptionProviderId` when a
 * user picks it as their transcription default.
 */
export const RIFFADO_INCLUDED_PROVIDER_ID = "riffado-included";

/**
 * User-facing label. "Mynah" is the Riffado transcription product
 * (mynah.riffado.com); only the underlying model name ("parakeet")
 * stays internal.
 */
export const RIFFADO_INCLUDED_PROVIDER_LABEL = "Mynah";

export function isRiffadoIncludedProviderId(
    id: string | null | undefined,
): boolean {
    return id === RIFFADO_INCLUDED_PROVIDER_ID;
}

export interface ManagedProvider {
    id: string;
    provider: string;
    baseUrl: null;
    defaultModel: null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: false;
    /** Marks this as the instance-managed provider (no edit/delete). */
    managed: true;
    /** Headline monthly capacity in seconds (Pro grant), for display. */
    includedSeconds: number;
    /** False when the user's current plan can't use it (e.g. lapsed). */
    available: boolean;
    createdAt: Date;
}

/**
 * The Riffado-included transcription provider, surfaced in the Providers
 * list as a first-class managed option.
 *
 * Returns `null` on self-host or when the instance hasn't configured the
 * managed transcription backend — in those cases users bring their own
 * provider and there is nothing included to show.
 *
 * `includedSeconds` is the Pro capacity (shown as "up to Nh/month") so a
 * lapsed account still sees what resubscribing unlocks; `available` gates
 * whether it can actually be used right now.
 */
export async function getManagedTranscriptionProvider(
    userId: string,
    isDefault: boolean,
): Promise<ManagedProvider | null> {
    if (!isMynahConfigured()) return null;

    const entitlements = await getEntitlements(userId);

    return {
        id: RIFFADO_INCLUDED_PROVIDER_ID,
        provider: RIFFADO_INCLUDED_PROVIDER_LABEL,
        baseUrl: null,
        defaultModel: null,
        isDefaultTranscription: isDefault,
        isDefaultEnhancement: false,
        managed: true,
        includedSeconds: entitlements.monthlyMynahSeconds,
        available: entitlements.monthlyMynahSeconds > 0,
        // Sort key only; managed provider is rendered first regardless.
        createdAt: new Date(0),
    };
}
