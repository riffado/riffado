import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { isRiffadoIncludedProviderId } from "@/lib/transcription/included-provider";

/**
 * Set (or clear) a user's default transcription provider.
 *
 * `value` is an `api_credentials` id, the managed included sentinel, or
 * null to clear. Writes the authoritative pointer on `user_settings` and
 * mirrors the legacy per-row `isDefaultTranscription` booleans so both
 * stay consistent: all rows cleared, then the chosen credential (if any)
 * flagged. The managed sentinel and null leave no row flagged.
 *
 * Ownership of a credential id must be validated by the caller before
 * calling this.
 */
export async function setDefaultTranscriptionProvider(
    userId: string,
    value: string | null,
): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .insert(userSettings)
            .values({ userId, defaultTranscriptionProviderId: value })
            .onConflictDoUpdate({
                target: userSettings.userId,
                set: {
                    defaultTranscriptionProviderId: value,
                    updatedAt: new Date(),
                },
            });

        await tx
            .update(apiCredentials)
            .set({ isDefaultTranscription: false })
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            );

        if (value && !isRiffadoIncludedProviderId(value)) {
            await tx
                .update(apiCredentials)
                .set({ isDefaultTranscription: true })
                .where(
                    and(
                        eq(apiCredentials.id, value),
                        eq(apiCredentials.userId, userId),
                    ),
                );
        }
    });
}
