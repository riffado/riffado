import { eq } from "drizzle-orm";
import { ArchiveVaultClient } from "@/components/archive/archive-vault-client";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";

export const metadata = { title: "Archive Vault – Mesynx AI" };

export default async function ArchivePage() {
    const session = await requireAuth();

    const [settings] = await db
        .select({ vaultPin: userSettings.vaultPin })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    // PIN lock is set when the column is non-null and non-empty.
    // Matching the exact logic in GET /api/archive/vault.
    const hasPinLock = !!settings?.vaultPin;

    return <ArchiveVaultClient hasPinLock={hasPinLock} />;
}
