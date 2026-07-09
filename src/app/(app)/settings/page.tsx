import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { listUserProviders } from "@/lib/ai/list-providers";
import { requireAuth } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function SettingsPage() {
    const session = await requireAuth();

    const providers = await listUserProviders(session.user.id);

    return (
        <SettingsPageContent
            initialProviders={providers}
            isHosted={env.IS_HOSTED}
        />
    );
}
