import { eq } from "drizzle-orm";
import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function SettingsPage() {
    const session = await requireAuth();

    // Fetch user's AI providers
    const providers = await db
        .select({
            id: apiCredentials.id,
            provider: apiCredentials.provider,
            baseUrl: apiCredentials.baseUrl,
            defaultModel: apiCredentials.defaultModel,
            isDefaultTranscription: apiCredentials.isDefaultTranscription,
            isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
            createdAt: apiCredentials.createdAt,
        })
        .from(apiCredentials)
        .where(eq(apiCredentials.userId, session.user.id));

    return (
        <SettingsPageContent
            initialProviders={providers}
            isHosted={env.IS_HOSTED}
        />
    );
}
