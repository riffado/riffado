import { asc, eq } from "drizzle-orm";
import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { listUserProviders } from "@/lib/ai/list-providers";
import { requireAuth, requireCompletedOnboarding } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function SettingsPage() {
    const session = await requireAuth();
    await requireCompletedOnboarding(session);

    const [providers, devices, [connection]] = await Promise.all([
        listUserProviders(session.user.id),
        db
            .select({
                serialNumber: plaudDevices.serialNumber,
                name: plaudDevices.name,
                model: plaudDevices.model,
            })
            .from(plaudDevices)
            .where(eq(plaudDevices.userId, session.user.id))
            .orderBy(asc(plaudDevices.createdAt)),
        db
            .select({ lastSync: plaudConnections.lastSync })
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1),
    ]);

    return (
        <SettingsPageContent
            initialProviders={providers}
            isHosted={env.IS_HOSTED}
            devices={devices}
            plaudLastSyncAt={connection?.lastSync?.toISOString() ?? null}
        />
    );
}
