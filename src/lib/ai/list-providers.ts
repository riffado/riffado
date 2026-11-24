import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { chatGptAccountEmail } from "@/lib/ai/chatgpt/connect";
import { isChatGptProvider } from "@/lib/ai/chatgpt/shared";
import {
    getManagedTranscriptionProvider,
    isRiffadoIncludedProviderId,
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
    /** ChatGPT plan usage only: the signed-in ChatGPT account email. */
    accountEmail?: string | null;
}

/**
 * List a user's transcription/enhancement providers for the Providers UI.
 *
 * The authoritative transcription default is
 * `userSettings.defaultTranscriptionProviderId` (a credential id, the
 * managed sentinel, or null) — the per-row `isDefaultTranscription`
 * boolean is derived from it here so the UI has a single source of truth.
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
            createdAt: apiCredentials.createdAt,
            apiKey: apiCredentials.apiKey,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, userId));

    // Never return the encrypted key; for ChatGPT rows expose only the
    // signed-in account email so the UI can show which account is linked.
    const credentials: ProviderListItem[] = rows.map(({ apiKey, ...row }) => ({
        ...row,
        isDefaultTranscription: row.id === pointer,
        ...(isChatGptProvider(row.provider)
            ? { accountEmail: chatGptAccountEmail(apiKey) }
            : {}),
    }));

    const managed = await getManagedTranscriptionProvider(
        userId,
        isRiffadoIncludedProviderId(pointer),
    );

    return managed ? [managed, ...credentials] : credentials;
}
