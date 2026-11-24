import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { selectTranscriptionProvider } from "@/lib/transcription/effective-provider";
import {
    getManagedTranscriptionProvider,
    RIFFADO_INCLUDED_PROVIDER_ID,
} from "@/lib/transcription/included-provider";

export interface ProviderListItem {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
    /** Present and true only for the instance-managed included provider. */
    managed?: boolean;
    /** Managed only: headline monthly capacity in seconds. */
    includedSeconds?: number;
    /** Managed only: whether the current plan can use it right now. */
    available?: boolean;
}

/**
 * List a user's transcription/enhancement providers for the Providers UI.
 *
 * The authoritative transcription default is
 * `userSettings.defaultTranscriptionProviderId` (a credential id, the
 * managed sentinel, or null). The per-row `isDefaultTranscription` flag
 * marks the provider transcription actually uses, resolved with
 * `selectTranscriptionProvider`, so an unset pointer shows the legacy
 * default credential or Mynah as selected (Mynah only while the plan
 * includes it).
 * When the instance offers managed transcription, it is prepended as a
 * first-class entry.
 */
export async function listUserProviders(
    userId: string,
): Promise<ProviderListItem[]> {
    const [settings] = await db
        .select({ pointer: userSettings.defaultTranscriptionProviderId })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
    const pointer = settings?.pointer ?? null;

    const rows = await db
        .select({
            id: apiCredentials.id,
            provider: apiCredentials.provider,
            baseUrl: apiCredentials.baseUrl,
            defaultModel: apiCredentials.defaultModel,
            isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
            legacyDefault: apiCredentials.isDefaultTranscription,
            createdAt: apiCredentials.createdAt,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, userId));

    const legacyDefaultId = rows.find((row) => row.legacyDefault)?.id ?? null;
    const selection = selectTranscriptionProvider({
        pointer,
        hasLegacyDefaultCredential: legacyDefaultId !== null,
    });
    const effectiveId =
        selection.kind === "managed"
            ? RIFFADO_INCLUDED_PROVIDER_ID
            : selection.kind === "credential"
              ? (selection.credentialId ?? legacyDefaultId)
              : null;

    const credentials: ProviderListItem[] = rows.map(
        ({ legacyDefault: _legacyDefault, ...row }) => ({
            ...row,
            isDefaultTranscription: row.id === effectiveId,
        }),
    );

    const managed = await getManagedTranscriptionProvider(
        userId,
        effectiveId === RIFFADO_INCLUDED_PROVIDER_ID,
    );
    if (managed && pointer === null && managed.available === false) {
        managed.isDefaultTranscription = false;
    }

    return managed ? [managed, ...credentials] : credentials;
}
